/**
 * Email domain management: real DKIM keygen + durable checklist/health + mailboxes.
 */

import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmailDnsRecord, EmailExternalTodo, EmailHealthReport } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import {
  buildExternalTodos,
  planEmailStackInstall,
  planTestSend,
  scoreEmailHealth,
} from './dns-records.js';
import type { YskDatabase } from '../db/database.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import type { HostExecutor } from '../host/executor.js';
import { hashMailboxPassword } from './password-hash.js';

export interface EmailDomainRecord {
  id: string;
  domain: string;
  server_ip: string;
  mail_hostname: string;
  dkim_selector: string;
  dkim_public_key: string;
  dkim_private_key: string;
  dns_applied: boolean;
  dmarc_present: boolean;
  ptr_ok: boolean;
  port25_open: boolean | null;
  health_score: number;
  created_at: string;
  updated_at: string;
}

export class EmailService {
  constructor(
    private readonly db: YskDatabase,
    private readonly host: HostExecutor,
    private readonly audit?: AuditRepository,
    /** When set, mailbox provision writes Maildir + virtual maps under dataDir */
    private readonly dataDir?: string,
  ) {}

  list(): EmailDomainRecord[] {
    return domains(this.db).map((e) => ({ ...e }));
  }

  get(id: string): EmailDomainRecord {
    const row = domains(this.db).find((e) => e.id === id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到郵件域名：${id}`, { httpStatus: 404 });
    }
    return { ...row };
  }

  /**
   * Create domain with real RSA DKIM keypair and initial health score.
   */
  create(input: {
    domain: string;
    serverIp: string;
    mailHostname?: string;
    actor: string;
  }): {
    domain: EmailDomainRecord;
    records: EmailDnsRecord[];
    externalTodos: EmailExternalTodo[];
    health: EmailHealthReport;
    installPlan: ReturnType<typeof planEmailStackInstall>;
  } {
    const domain = input.domain.trim().toLowerCase();
    if (domains(this.db).some((e) => e.domain === domain)) {
      throw new YskError(ErrorCodes.VALIDATION, `域名已登記：${domain}`, {
        httpStatus: 400,
      });
    }

    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const dkimPublic = extractPemBody(publicKey);
    const selector = 'default';
    const mailHostname = input.mailHostname ?? `mail.${domain}`;
    const now = new Date().toISOString();

    const health = scoreEmailHealth({
      domain,
      serverIp: input.serverIp,
      dkimPublicKey: dkimPublic,
      mailHostname,
      ptrOk: false,
      port25Open: null,
      dnsApplied: false,
      dmarcPresent: false,
    });

    const row: EmailDomainRecord = {
      id: randomUUID(),
      domain,
      server_ip: input.serverIp,
      mail_hostname: mailHostname,
      dkim_selector: selector,
      dkim_public_key: dkimPublic,
      dkim_private_key: privateKey,
      dns_applied: false,
      dmarc_present: false,
      ptr_ok: false,
      port25_open: null,
      health_score: health.score,
      created_at: now,
      updated_at: now,
    };
    domains(this.db).unshift(row);
    this.db.persist();

    this.audit?.append({
      actor: input.actor,
      action: 'email.domain.create',
      resource: domain,
      detail: { id: row.id, health_score: health.score },
      ok: true,
    });

    return {
      domain: { ...row, dkim_private_key: '***redacted***' },
      records: health.records,
      externalTodos: health.externalTodos,
      health,
      installPlan: planEmailStackInstall(domain),
    };
  }

  /**
   * Update external checklist flags and recompute health.
   */
  updateChecks(
    id: string,
    checks: Partial<{
      dnsApplied: boolean;
      dmarcPresent: boolean;
      ptrOk: boolean;
      port25Open: boolean | null;
    }>,
    actor: string,
  ): { domain: EmailDomainRecord; health: EmailHealthReport } {
    const row = domains(this.db).find((e) => e.id === id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到郵件域名：${id}`, { httpStatus: 404 });
    }
    if (checks.dnsApplied !== undefined) row.dns_applied = checks.dnsApplied;
    if (checks.dmarcPresent !== undefined) row.dmarc_present = checks.dmarcPresent;
    if (checks.ptrOk !== undefined) row.ptr_ok = checks.ptrOk;
    if (checks.port25Open !== undefined) row.port25_open = checks.port25Open;
    row.updated_at = new Date().toISOString();

    const health = scoreEmailHealth({
      domain: row.domain,
      serverIp: row.server_ip,
      dkimPublicKey: row.dkim_public_key,
      mailHostname: row.mail_hostname,
      ptrOk: row.ptr_ok,
      port25Open: row.port25_open,
      dnsApplied: row.dns_applied,
      dmarcPresent: row.dmarc_present,
    });
    row.health_score = health.score;
    this.db.persist();

    this.audit?.append({
      actor,
      action: 'email.checks.update',
      resource: id,
      detail: checks,
      ok: true,
    });

    return {
      domain: { ...row, dkim_private_key: '***redacted***' },
      health,
    };
  }

  getDnsBundle(id: string): {
    records: EmailDnsRecord[];
    externalTodos: EmailExternalTodo[];
    health: EmailHealthReport;
  } {
    const row = this.get(id);
    const health = scoreEmailHealth({
      domain: row.domain,
      serverIp: row.server_ip,
      dkimPublicKey: row.dkim_public_key,
      mailHostname: row.mail_hostname,
      ptrOk: row.ptr_ok,
      port25Open: row.port25_open,
      dnsApplied: row.dns_applied,
      dmarcPresent: row.dmarc_present,
    });
    return {
      records: health.records,
      externalTodos: buildExternalTodos({
        domain: row.domain,
        mailHostname: row.mail_hostname,
        ptrOk: row.ptr_ok,
        port25Open: row.port25_open,
        dnsApplied: row.dns_applied,
        dmarcPresent: row.dmarc_present,
      }),
      health,
    };
  }

  /**
   * Provision mailbox: always write managed Maildir + virtual maps under dataDir when available.
   * Optional system vmail user when root + YSK_EXECUTE + provisionSystem.
   * Never fakes system provision success.
   */
  async createMailbox(
    domainId: string,
    input: {
      localPart: string;
      actor: string;
      password?: string;
      /** Attempt system useradd under vmail (needs root + EXECUTE) */
      provisionSystem?: boolean;
    },
  ): Promise<{
    ok: boolean;
    mailbox: Record<string, unknown>;
    notes: string[];
    written: string[];
    requiresExecute: boolean;
    requiresRoot: boolean;
    commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
  }> {
    const row = this.get(domainId);
    const local = input.localPart.trim().toLowerCase();
    if (!/^[a-z0-9._+-]{1,64}$/.test(local)) {
      throw new YskError(ErrorCodes.VALIDATION, '郵箱本地部分無效', { httpStatus: 400 });
    }
    const address = `${local}@${row.domain}`;
    const existing = this.db.snapshot.mailboxes.find(
      (m) => String(m.address).toLowerCase() === address,
    );
    if (existing) {
      throw new YskError(ErrorCodes.VALIDATION, `郵箱已存在：${address}`, {
        httpStatus: 409,
      });
    }

    const notes: string[] = [];
    const written: string[] = [];
    const commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }> = [];
    let maildirPath: string | undefined;
    let passwordHash: string | undefined;
    let passwordScheme: string | undefined;

    if (input.password && input.password.length >= 8) {
      const hashed = await hashMailboxPassword(input.password);
      passwordHash = hashed.hash;
      passwordScheme = hashed.scheme;
      notes.push(...hashed.notes);
    } else if (input.password) {
      notes.push('密碼過短（至少 8 字）— 郵箱已建立但未寫入雜湊');
    }

    if (this.dataDir) {
      const base = join(this.dataDir, 'email', row.domain, 'mailboxes', local);
      const cur = join(base, 'Maildir', 'cur');
      const newDir = join(base, 'Maildir', 'new');
      const tmp = join(base, 'Maildir', 'tmp');
      mkdirSync(cur, { recursive: true });
      mkdirSync(newDir, { recursive: true });
      mkdirSync(tmp, { recursive: true });
      maildirPath = join(base, 'Maildir');
      writeFileSync(
        join(base, 'README.txt'),
        [
          `YSK managed mailbox ${address}`,
          `Maildir: ${maildirPath}`,
          'Load via Postfix virtual_mailbox_maps + Dovecot mail_location',
          '',
        ].join('\n'),
        'utf8',
      );
      written.push(maildirPath, join(base, 'README.txt'));
      notes.push(`已建立 Maildir：${maildirPath}`);
    } else {
      notes.push('EmailService 無 dataDir — 只寫資料庫（需 dataDir 才建 Maildir）');
    }

    const wantSystem = Boolean(input.provisionSystem);
    const canSystem = wantSystem && this.host.executeEnabled() && this.host.isRoot();
    let systemUser: string | undefined;
    let status = 'managed';

    if (wantSystem && !canSystem) {
      notes.push('無法建立系統郵件用戶：需要系統管理員權限');
      status = 'managed_pending_system';
    }

    if (canSystem) {
      systemUser = `vmail_${local}`.replace(/[^a-z0-9_]/g, '').slice(0, 32);
      const home = maildirPath
        ? join(maildirPath, '..')
        : `/var/mail/vhosts/${row.domain}/${local}`;
      const mk = await this.host.runCommand(['mkdir', '-p', home], { timeoutMs: 10_000 });
      commandResults.push({
        argv: ['mkdir', '-p', home],
        exitCode: mk.exitCode,
        stderr: mk.stderr,
      });
      const ua = await this.host.runCommand(
        ['useradd', '-r', '-m', '-d', home, '-s', '/usr/sbin/nologin', systemUser],
        { timeoutMs: 30_000 },
      );
      commandResults.push({
        argv: ['useradd', systemUser],
        exitCode: ua.exitCode,
        stderr: ua.stderr,
      });
      if (ua.exitCode === 0) {
        status = 'system_provisioned';
        notes.push(`已建立系統用戶 ${systemUser}`);
      } else {
        status = 'managed_system_failed';
        notes.push(`建立系統用戶失敗：${ua.stderr || ua.stdout}`);
      }
    }

    // rewrite virtual maps for domain from all mailboxes
    if (this.dataDir) {
      const mapDir = join(this.dataDir, 'email', row.domain, 'postfix');
      mkdirSync(mapDir, { recursive: true });
      const allForDomain = [
        ...this.db.snapshot.mailboxes.filter((m) => m.domain_id === domainId),
        {
          address,
          local_part: local,
          maildir: maildirPath,
        },
      ];
      const vmailbox = allForDomain
        .map((m) => {
          const md =
            (m.maildir as string) ||
            join(this.dataDir!, 'email', row.domain, 'mailboxes', String(m.local_part), 'Maildir');
          // postfix virtual_mailbox_maps: trailing / means Maildir
          return `${m.address} ${md}/`;
        })
        .join('\n');
      const vpath = join(mapDir, 'virtual_mailbox');
      writeFileSync(vpath, vmailbox + '\n', 'utf8');
      written.push(vpath);
      notes.push(`虛擬郵箱對應：${vpath}`);
    }

    const mailbox = {
      id: randomUUID(),
      domain_id: domainId,
      domain: row.domain,
      local_part: local,
      address,
      status,
      maildir: maildirPath,
      system_user: systemUser,
      password_scheme: passwordScheme,
      created_at: new Date().toISOString(),
    };
    this.db.snapshot.mailboxes.unshift({
      ...mailbox,
      password_hash: passwordHash,
    });
    this.db.persist();

    // Refresh Dovecot passdb for this domain when dataDir present
    if (this.dataDir) {
      try {
        const { writeDovecotPassdb } = await import('./dovecot-passdb.js');
        const pd = writeDovecotPassdb({
          dataDir: this.dataDir,
          db: this.db,
          domain: row.domain,
          domainId,
        });
        written.push(...pd.written);
        notes.push(...pd.notes.filter((n) => !notes.includes(n)));
      } catch (e) {
        notes.push(`寫入 passdb 失敗：${e instanceof Error ? e.message : String(e)}`);
      }
    }

    this.audit?.append({
      actor: input.actor,
      action: 'email.mailbox.create',
      resource: address,
      detail: {
        id: mailbox.id,
        status,
        maildir: maildirPath,
        systemUser,
        hasPassword: Boolean(passwordHash),
      },
      ok: status !== 'managed_system_failed',
    });

    const ok = !wantSystem || canSystem ? status !== 'managed_system_failed' : true;
    // If system was requested but skipped, still ok for managed Maildir path
    const finalOk = wantSystem && !canSystem ? true : ok;

    return {
      ok: finalOk,
      mailbox: {
        id: mailbox.id,
        domain_id: domainId,
        domain: row.domain,
        local_part: local,
        address,
        status,
        maildir: maildirPath,
        system_user: systemUser,
        has_password: Boolean(passwordHash),
        created_at: mailbox.created_at,
      },
      notes,
      written,
      requiresExecute: !this.host.executeEnabled(),
      requiresRoot: !this.host.isRoot(),
      commandResults,
    };
  }

  listMailboxes(domainId?: string): Array<Record<string, unknown>> {
    const all = this.db.snapshot.mailboxes;
    const map = (m: Record<string, unknown>) => {
      const { password_hash: _ph, password_hash_full: _pf, ...rest } = m;
      return {
        ...rest,
        has_password: Boolean(_ph || _pf),
      };
    };
    if (!domainId) return all.map(map);
    return all.filter((m) => m.domain_id === domainId).map(map);
  }

  /**
   * Alias / forward / catch-all entries for a domain.
   * type=catchall uses local_part="*" → virtual_alias `@domain dest`
   */
  listAliases(domainId: string): Array<Record<string, unknown>> {
    this.get(domainId);
    return (this.db.snapshot.email_aliases ?? [])
      .filter((a) => a.domain_id === domainId)
      .map((a) => ({ ...a }));
  }

  createAlias(
    domainId: string,
    input: {
      type: 'alias' | 'forward' | 'catchall';
      /** ignored for catchall */
      localPart?: string;
      destinations: string[];
      actor: string;
    },
  ): { ok: boolean; alias: Record<string, unknown>; notes: string[]; written: string[] } {
    const row = this.get(domainId);
    const type = input.type;
    const dests = input.destinations
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (!dests.length) {
      throw new YskError(ErrorCodes.VALIDATION, '至少一個轉送目標', { httpStatus: 400 });
    }
    for (const d of dests) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d) && type !== 'alias') {
        // allow local-only targets like postmaster for alias within domain
      }
    }
    let local = (input.localPart ?? '').trim().toLowerCase();
    if (type === 'catchall') {
      local = '*';
    } else {
      if (!/^[a-z0-9._+-]{1,64}$/.test(local)) {
        throw new YskError(ErrorCodes.VALIDATION, '本地部分無效', { httpStatus: 400 });
      }
    }
    const source =
      type === 'catchall' ? `@${row.domain}` : `${local}@${row.domain}`;
    const existing = (this.db.snapshot.email_aliases ?? []).find(
      (a) => a.domain_id === domainId && String(a.source).toLowerCase() === source,
    );
    if (existing) {
      throw new YskError(ErrorCodes.VALIDATION, `來源已存在: ${source}`, { httpStatus: 409 });
    }
    const alias = {
      id: randomUUID(),
      domain_id: domainId,
      domain: row.domain,
      type,
      local_part: local,
      source,
      destinations: dests,
      created_at: new Date().toISOString(),
    };
    if (!this.db.snapshot.email_aliases) this.db.snapshot.email_aliases = [];
    this.db.snapshot.email_aliases.unshift(alias);
    this.db.persist();
    const written = this.rewriteVirtualAliasMap(domainId);
    this.audit?.append({
      actor: input.actor,
      action: 'email.alias.create',
      resource: source,
      detail: { destinations: dests, type },
      ok: true,
    });
    return {
      ok: true,
      alias,
      notes: [`已建立 ${type}: ${source} → ${dests.join(', ')}`, ...written.notes],
      written: written.written,
    };
  }

  deleteAlias(
    domainId: string,
    aliasId: string,
    actor: string,
  ): { ok: boolean; notes: string[]; written: string[] } {
    this.get(domainId);
    const before = (this.db.snapshot.email_aliases ?? []).length;
    this.db.snapshot.email_aliases = (this.db.snapshot.email_aliases ?? []).filter(
      (a) => !(a.domain_id === domainId && a.id === aliasId),
    );
    const ok = this.db.snapshot.email_aliases.length < before;
    if (!ok) {
      throw new YskError(ErrorCodes.NOT_FOUND, '找不到別名', { httpStatus: 404 });
    }
    this.db.persist();
    const written = this.rewriteVirtualAliasMap(domainId);
    this.audit?.append({
      actor,
      action: 'email.alias.delete',
      resource: aliasId,
      detail: {},
      ok: true,
    });
    return { ok: true, notes: ['已刪除', ...written.notes], written: written.written };
  }

  /** Catch-all / autoreply flags on domain record */
  updateDomainMailFlags(
    domainId: string,
    patch: {
      catchallAddress?: string | null;
      autoreplyEnabled?: boolean;
      autoreplySubject?: string;
      autoreplyBody?: string;
      rateLimitPerHour?: number | null;
      antispam?: boolean;
      suspended?: boolean;
    },
    actor: string,
  ): EmailDomainRecord {
    const row = domains(this.db).find((e) => e.id === domainId) as EmailDomainRecord &
      Record<string, unknown>;
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到郵件域名：${domainId}`, {
        httpStatus: 404,
      });
    }
    if (patch.catchallAddress !== undefined) {
      row.catchall_address = patch.catchallAddress || undefined;
      // sync catchall alias row
      const existing = (this.db.snapshot.email_aliases ?? []).find(
        (a) => a.domain_id === domainId && a.type === 'catchall',
      );
      if (patch.catchallAddress) {
        if (existing) {
          existing.destinations = [patch.catchallAddress.trim().toLowerCase()];
          existing.source = `@${row.domain}`;
        } else {
          this.createAlias(domainId, {
            type: 'catchall',
            destinations: [patch.catchallAddress],
            actor,
          });
        }
      } else if (existing) {
        this.deleteAlias(domainId, String(existing.id), actor);
      }
    }
    if (patch.autoreplyEnabled !== undefined) row.autoreply_enabled = patch.autoreplyEnabled;
    if (patch.autoreplySubject !== undefined) row.autoreply_subject = patch.autoreplySubject;
    if (patch.autoreplyBody !== undefined) row.autoreply_body = patch.autoreplyBody;
    if (patch.rateLimitPerHour !== undefined) {
      row.rate_limit_per_hour = patch.rateLimitPerHour ?? undefined;
    }
    if (patch.antispam !== undefined) row.antispam = patch.antispam;
    if (patch.suspended !== undefined) {
      row.suspended = patch.suspended;
      row.status = patch.suspended ? 'suspended' : 'active';
    }
    row.updated_at = new Date().toISOString();
    this.db.persist();
    this.rewriteVirtualAliasMap(domainId);
    this.audit?.append({
      actor,
      action: 'email.domain.flags',
      resource: domainId,
      detail: patch,
      ok: true,
    });
    return { ...row, dkim_private_key: '***redacted***' };
  }

  private rewriteVirtualAliasMap(domainId: string): { written: string[]; notes: string[] } {
    const written: string[] = [];
    const notes: string[] = [];
    if (!this.dataDir) {
      notes.push('無 dataDir — 只更新資料庫');
      return { written, notes };
    }
    const row = this.get(domainId);
    const mapDir = join(this.dataDir, 'email', row.domain, 'postfix');
    mkdirSync(mapDir, { recursive: true });
    const aliases = (this.db.snapshot.email_aliases ?? []).filter((a) => a.domain_id === domainId);
    const lines = aliases.map((a) => {
      const dest = (a.destinations as string[]).join(',');
      return `${a.source} ${dest}`;
    });
    // also emit catchall_address if set and no catchall row
    const d = domains(this.db).find((e) => e.id === domainId) as EmailDomainRecord & {
      catchall_address?: string;
    };
    if (d?.catchall_address && !aliases.some((a) => a.type === 'catchall')) {
      lines.push(`@${row.domain} ${d.catchall_address}`);
    }
    const path = join(mapDir, 'virtual_alias');
    writeFileSync(path, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
    written.push(path);
    notes.push(`virtual_alias: ${path} (${lines.length} 條)`);
    return { written, notes };
  }

  markApplyStatus(
    domainId: string,
    status: { ok: boolean; notes?: string[]; serviceStatus?: Record<string, string> },
  ): void {
    const row = domains(this.db).find((e) => e.id === domainId);
    if (!row) return;
    (row as EmailDomainRecord & { apply_status?: string; last_apply?: unknown }).apply_status =
      status.ok ? 'applied' : 'failed';
    (row as EmailDomainRecord & { last_apply?: unknown }).last_apply = {
      ...status,
      at: new Date().toISOString(),
    };
    (row as EmailDomainRecord).updated_at = new Date().toISOString();
    this.db.persist();
  }

  /**
   * Attempt real test send via sendmail if available; otherwise structured failure.
   */
  async testSend(
    id: string,
    input: { from: string; to: string; subject?: string },
    actor: string,
  ): Promise<{ ok: boolean; plan: ReturnType<typeof planTestSend>; result?: unknown }> {
    const row = this.get(id);
    const plan = planTestSend(input);
    if (!this.host.executeEnabled()) {
      this.audit?.append({
        actor,
        action: 'email.test_send',
        resource: row.domain,
        detail: { ok: false, reason: 'YSK_EXECUTE not enabled' },
        ok: false,
      });
      return {
        ok: false,
        plan,
        result: {
          error: '無法寄送測試信：伺服器未開啟系統變更權限或未安裝郵件服務',
          domain: row.domain,
        },
      };
    }
    // Prefer printf | sendmail via bash -c only if execute enabled; use exec argv safely
    const r = await this.host.runCommand(
      ['bash', '-c', plan.command],
      { timeoutMs: 15_000 },
    );
    const ok = r.exitCode === 0;
    this.audit?.append({
      actor,
      action: 'email.test_send',
      resource: row.domain,
      detail: { ok, exitCode: r.exitCode, stderr: r.stderr },
      ok,
    });
    return { ok, plan, result: r };
  }
}

function extractPemBody(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
}

function domains(db: YskDatabase): EmailDomainRecord[] {
  return db.snapshot.email_domains as unknown as EmailDomainRecord[];
}
