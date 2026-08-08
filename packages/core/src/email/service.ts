/**
 * Email domain management: real DKIM keygen + durable checklist/health + mailboxes.
 */

import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { EmailDnsRecord, EmailExternalTodo, EmailHealthReport } from '@ysk/shared';
import { ErrorCodes, YskError, tl} from '@ysk/shared';
import {
  buildExternalTodos,
  planEmailStackInstall,
  planTestSend,
  scoreEmailHealth } from './dns-records.js';
import type { YskDatabase } from '../db/database.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import type { HostExecutor } from '../host/executor.js';
import { hashMailboxPassword } from './password-hash.js';

export interface EmailDomainRecord {
  id: string;
  domain: string;
  server_ip: string;
  /** Optional public IPv6 for AAAA / SPF ip6: */
  server_ipv6?: string;
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
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.email.domainNotFound', { id }), { httpStatus: 404 });
    }
    return { ...row };
  }

  /**
   * Create domain with real RSA DKIM keypair and initial health score.
   */
  create(input: {
    domain: string;
    serverIp: string;
    serverIpv6?: string;
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
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0081', { v0: (domain) }), {
        httpStatus: 400 });
    }

    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const dkimPublic = extractPemBody(publicKey);
    const selector = 'default';
    const mailHostname = input.mailHostname ?? `mail.${domain}`;
    const now = new Date().toISOString();
    const serverIpv6 = input.serverIpv6?.trim() || undefined;

    const health = scoreEmailHealth({
      domain,
      serverIp: input.serverIp,
      serverIpv6,
      dkimPublicKey: dkimPublic,
      mailHostname,
      ptrOk: false,
      port25Open: null,
      dnsApplied: false,
      dmarcPresent: false });

    const row: EmailDomainRecord = {
      id: randomUUID(),
      domain,
      server_ip: input.serverIp,
      ...(serverIpv6 ? { server_ipv6: serverIpv6 } : {}),
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
      updated_at: now };
    domains(this.db).unshift(row);
    this.db.persist();

    this.audit?.append({
      actor: input.actor,
      action: 'email.domain.create',
      resource: domain,
      detail: { id: row.id, health_score: health.score },
      ok: true });

    return {
      domain: { ...row, dkim_private_key: '***redacted***' },
      records: health.records,
      externalTodos: health.externalTodos,
      health,
      installPlan: planEmailStackInstall(domain) };
  }

  /**
   * Delete email domain from control plane + related mailboxes/aliases.
   * Best-effort remove dataDir/email/{domain}. Does not claim system Postfix/Dovecot
   * maps were rewritten — operator may re-apply remaining domains.
   */
  deleteDomain(
    id: string,
    actor: string,
  ): {
    ok: boolean;
    domain: string;
    removedMailboxes: number;
    removedAliases: number;
    notes: string[];
    written: string[];
  } {
    const row = domains(this.db).find((e) => e.id === id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.email.domainNotFound', { id }), {
        httpStatus: 404,
      });
    }
    const domainName = row.domain;
    const notes: string[] = [];
    const written: string[] = [];

    const beforeMb = this.db.snapshot.mailboxes.length;
    this.db.snapshot.mailboxes = this.db.snapshot.mailboxes.filter(
      (m) => String(m.domain_id) !== id,
    );
    const removedMailboxes = beforeMb - this.db.snapshot.mailboxes.length;

    const aliases = this.db.snapshot.email_aliases ?? [];
    const beforeAl = aliases.length;
    this.db.snapshot.email_aliases = aliases.filter((a) => String(a.domain_id) !== id);
    const removedAliases = beforeAl - (this.db.snapshot.email_aliases?.length ?? 0);

    this.db.snapshot.email_domains = domains(this.db).filter(
      (e) => e.id !== id,
    ) as unknown as typeof this.db.snapshot.email_domains;
    this.db.persist();

    notes.push(
      tl('notes.email.domainDeleted', {
        domain: domainName,
        mailboxes: removedMailboxes,
        aliases: removedAliases,
      }),
    );

    if (this.dataDir) {
      const dir = join(this.dataDir, 'email', domainName);
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true });
          written.push(dir);
          notes.push(tl('notes.email.domainDataDirRemoved', { path: dir }));
        } catch (e) {
          notes.push(
            tl('notes.email.domainDataDirRemoveFailed', {
              path: dir,
              detail: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      }
    }

    notes.push(tl('notes.email.domainDeleteSystemHint'));

    this.audit?.append({
      actor,
      action: 'email.domain.delete',
      resource: domainName,
      detail: {
        id,
        removedMailboxes,
        removedAliases,
        written,
      },
      ok: true,
    });

    return {
      ok: true,
      domain: domainName,
      removedMailboxes,
      removedAliases,
      notes,
      written,
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
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.email.domainNotFound', { id }), { httpStatus: 404 });
    }
    if (checks.dnsApplied !== undefined) row.dns_applied = checks.dnsApplied;
    if (checks.dmarcPresent !== undefined) row.dmarc_present = checks.dmarcPresent;
    if (checks.ptrOk !== undefined) row.ptr_ok = checks.ptrOk;
    if (checks.port25Open !== undefined) row.port25_open = checks.port25Open;
    row.updated_at = new Date().toISOString();

    const health = scoreEmailHealth({
      domain: row.domain,
      serverIp: row.server_ip,
      serverIpv6: row.server_ipv6,
      dkimPublicKey: row.dkim_public_key,
      mailHostname: row.mail_hostname,
      ptrOk: row.ptr_ok,
      port25Open: row.port25_open,
      dnsApplied: row.dns_applied,
      dmarcPresent: row.dmarc_present });
    row.health_score = health.score;
    this.db.persist();

    this.audit?.append({
      actor,
      action: 'email.checks.update',
      resource: id,
      detail: checks,
      ok: true });

    return {
      domain: { ...row, dkim_private_key: '***redacted***' },
      health };
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
      serverIpv6: row.server_ipv6,
      dkimPublicKey: row.dkim_public_key,
      mailHostname: row.mail_hostname,
      ptrOk: row.ptr_ok,
      port25Open: row.port25_open,
      dnsApplied: row.dns_applied,
      dmarcPresent: row.dmarc_present });
    return {
      records: health.records,
      externalTodos: buildExternalTodos({
        domain: row.domain,
        mailHostname: row.mail_hostname,
        ptrOk: row.ptr_ok,
        port25Open: row.port25_open,
        dnsApplied: row.dns_applied,
        dmarcPresent: row.dmarc_present }),
      health };
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
      /** Panel user for package quota ownership */
      actorUserId?: string;
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
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1509'), { httpStatus: 400 });
    }
    const address = `${local}@${row.domain}`;
    const existing = this.db.snapshot.mailboxes.find(
      (m) => String(m.address).toLowerCase() === address,
    );
    if (existing) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0082', { v0: (address) }), {
        httpStatus: 409 });
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
      notes.push(tl('notes.auto.n0668'));
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
      notes.push(tl('notes.auto.t0083', { v0: (maildirPath) }));
    } else {
      notes.push(tl('notes.auto.n0102'));
    }

    const wantSystem = Boolean(input.provisionSystem);
    const canSystem = wantSystem && this.host.executeEnabled() && this.host.isRoot();
    let systemUser: string | undefined;
    let status = 'managed';

    if (wantSystem && !canSystem) {
      notes.push(tl('notes.auto.n1169'));
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
        stderr: mk.stderr });
      const ua = await this.host.runCommand(
        ['useradd', '-r', '-m', '-d', home, '-s', '/usr/sbin/nologin', systemUser],
        { timeoutMs: 30_000 },
      );
      commandResults.push({
        argv: ['useradd', systemUser],
        exitCode: ua.exitCode,
        stderr: ua.stderr });
      if (ua.exitCode === 0) {
        status = 'system_provisioned';
        notes.push(tl('notes.auto.t0084', { v0: (systemUser) }));
      } else {
        status = 'managed_system_failed';
        notes.push(tl('notes.auto.t0085', { v0: (ua.stderr || ua.stdout) }));
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
          maildir: maildirPath },
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
      notes.push(tl('notes.auto.t0086', { v0: (vpath) }));
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
      owner_user_id: input.actorUserId,
      created_at: new Date().toISOString() };
    this.db.snapshot.mailboxes.unshift({
      ...mailbox,
      password_hash: passwordHash });
    this.db.persist();

    // Refresh Dovecot passdb for this domain when dataDir present
    if (this.dataDir) {
      try {
        const { writeDovecotPassdb } = await import('./dovecot-passdb.js');
        const pd = writeDovecotPassdb({
          dataDir: this.dataDir,
          db: this.db,
          domain: row.domain,
          domainId });
        written.push(...pd.written);
        notes.push(...pd.notes.filter((n) => !notes.includes(n)));
      } catch (e) {
        notes.push(tl('notes.auto.t0087', { v0: (e instanceof Error ? e.message : String(e)) }));
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
        hasPassword: Boolean(passwordHash) },
      ok: status !== 'managed_system_failed' });

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
        created_at: mailbox.created_at },
      notes,
      written,
      requiresExecute: !this.host.executeEnabled(),
      requiresRoot: !this.host.isRoot(),
      commandResults };
  }

  listMailboxes(domainId?: string): Array<Record<string, unknown>> {
    const all = this.db.snapshot.mailboxes;
    const map = (m: Record<string, unknown>) => {
      const { password_hash: _ph, password_hash_full: _pf, ...rest } = m;
      return {
        ...rest,
        has_password: Boolean(_ph || _pf) };
    };
    if (!domainId) return all.map(map);
    return all.filter((m) => m.domain_id === domainId).map(map);
  }

  /**
   * Delete one mailbox from control plane + Maildir best-effort; rewrite maps.
   */
  async deleteMailbox(
    domainId: string,
    mailboxId: string,
    actor: string,
  ): Promise<{
    ok: boolean;
    address: string;
    notes: string[];
    written: string[];
  }> {
    const row = this.get(domainId);
    const mb = this.db.snapshot.mailboxes.find(
      (m) => String(m.id) === mailboxId && String(m.domain_id) === domainId,
    );
    if (!mb) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.email.mailboxNotFound'), {
        httpStatus: 404,
      });
    }
    const address = String(mb.address ?? '');
    const notes: string[] = [];
    const written: string[] = [];

    this.db.snapshot.mailboxes = this.db.snapshot.mailboxes.filter(
      (m) => !(String(m.id) === mailboxId && String(m.domain_id) === domainId),
    );
    this.db.persist();
    notes.push(tl('notes.email.mailboxDeleted', { address }));

    if (this.dataDir) {
      const local = String(mb.local_part ?? address.split('@')[0] ?? '');
      const base = join(this.dataDir, 'email', row.domain, 'mailboxes', local);
      if (existsSync(base)) {
        try {
          rmSync(base, { recursive: true, force: true });
          written.push(base);
          notes.push(tl('notes.email.mailboxDataRemoved', { path: base }));
        } catch {
          /* best-effort */
        }
      }
      // rewrite virtual_mailbox from remaining
      const mapDir = join(this.dataDir, 'email', row.domain, 'postfix');
      mkdirSync(mapDir, { recursive: true });
      const remaining = this.db.snapshot.mailboxes.filter((m) => m.domain_id === domainId);
      const vmailbox = remaining
        .map((m) => {
          const md =
            (m.maildir as string) ||
            join(
              this.dataDir!,
              'email',
              row.domain,
              'mailboxes',
              String(m.local_part),
              'Maildir',
            );
          return `${m.address} ${md}/`;
        })
        .join('\n');
      const vpath = join(mapDir, 'virtual_mailbox');
      writeFileSync(vpath, vmailbox ? vmailbox + '\n' : '', 'utf8');
      written.push(vpath);
      try {
        const { writeDovecotPassdb } = await import('./dovecot-passdb.js');
        const pd = writeDovecotPassdb({
          dataDir: this.dataDir,
          db: this.db,
          domain: row.domain,
          domainId,
        });
        written.push(...pd.written);
        notes.push(...pd.notes.slice(0, 3));
      } catch {
        /* optional */
      }
    }
    notes.push(tl('notes.email.domainDeleteSystemHint'));

    this.audit?.append({
      actor,
      action: 'email.mailbox.delete',
      resource: address,
      detail: { id: mailboxId, domainId },
      ok: true,
    });

    return { ok: true, address, notes, written };
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
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1339'), { httpStatus: 400 });
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
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0993'), { httpStatus: 400 });
      }
    }
    const source =
      type === 'catchall' ? `@${row.domain}` : `${local}@${row.domain}`;
    const existing = (this.db.snapshot.email_aliases ?? []).find(
      (a) => a.domain_id === domainId && String(a.source).toLowerCase() === source,
    );
    if (existing) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0088', { v0: (source) }), { httpStatus: 409 });
    }
    const alias = {
      id: randomUUID(),
      domain_id: domainId,
      domain: row.domain,
      type,
      local_part: local,
      source,
      destinations: dests,
      created_at: new Date().toISOString() };
    if (!this.db.snapshot.email_aliases) this.db.snapshot.email_aliases = [];
    this.db.snapshot.email_aliases.unshift(alias);
    this.db.persist();
    const written = this.rewriteVirtualAliasMap(domainId);
    this.audit?.append({
      actor: input.actor,
      action: 'email.alias.create',
      resource: source,
      detail: { destinations: dests, type },
      ok: true });
    return {
      ok: true,
      alias,
      notes: [tl('notes.auto.t0089', { v0: (type), v1: (source), v2: (dests.join(', ')) }), ...written.notes],
      written: written.written };
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
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.n0855'), { httpStatus: 404 });
    }
    this.db.persist();
    const written = this.rewriteVirtualAliasMap(domainId);
    this.audit?.append({
      actor,
      action: 'email.alias.delete',
      resource: aliasId,
      detail: {},
      ok: true });
    return { ok: true, notes: [tl('notes.auto.n0736'), ...written.notes], written: written.written };
  }

  /**
   * Catch-all / autoreply / suspend flags on domain record.
   * Always writes control-plane + dataDir artifacts.
   * When applySystem=true: attempt Postfix suspend map + Dovecot sieve (EXECUTE+root).
   * Never pretends applied without successful host commands.
   */
  async updateDomainMailFlags(
    domainId: string,
    patch: {
      catchallAddress?: string | null;
      autoreplyEnabled?: boolean;
      autoreplySubject?: string;
      autoreplyBody?: string;
      rateLimitPerHour?: number | null;
      antispam?: boolean;
      suspended?: boolean;
      /** Attempt live Postfix/Dovecot apply */
      applySystem?: boolean;
    },
    actor: string,
  ): Promise<{
    domain: EmailDomainRecord;
    ok: boolean;
    notes: string[];
    written: string[];
    apply_status: 'written' | 'applied' | 'partial' | 'blocked';
    blocked?: boolean;
    blockMessage?: string;
    commandResults?: Array<{ argv: string[]; exitCode: number; stderr: string }>;
  }> {
    const row = domains(this.db).find((e) => e.id === domainId) as EmailDomainRecord &
      Record<string, unknown>;
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.t0090', { v0: (domainId) }), {
        httpStatus: 404 });
    }
    const notes: string[] = [];
    const written: string[] = [];

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
            actor });
        }
      } else if (existing) {
        this.deleteAlias(domainId, String(existing.id), actor);
      }
      notes.push(
        patch.catchallAddress
          ? `catch-all → ${patch.catchallAddress}（virtual_alias map）`
          : tl('notes.auto.n0787'),
      );
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
      notes.push(
        patch.suspended
          ? tl('notes.auto.n0631')
          : tl('notes.auto.n0630'),
      );
    }
    row.updated_at = new Date().toISOString();
    this.db.persist();
    const map = this.rewriteVirtualAliasMap(domainId);
    written.push(...map.written);
    notes.push(...map.notes);

    // Managed sieve vacation draft (written only — not auto-loaded by Dovecot)
    if (
      this.dataDir &&
      (patch.autoreplyEnabled !== undefined ||
        patch.autoreplySubject !== undefined ||
        patch.autoreplyBody !== undefined)
    ) {
      const domainName = String(row.domain);
      const sieveDirPath = join(this.dataDir, 'email', domainName, 'sieve');
      mkdirSync(sieveDirPath, { recursive: true });
      const enabled = Boolean(row.autoreply_enabled);
      const subject = String(row.autoreply_subject ?? tl('notes.auto.n1335'));
      const body = String(row.autoreply_body ?? '');
      const sievePath = join(sieveDirPath, 'vacation.sieve');
      const content = enabled
        ? [
            'require ["vacation"];',
            `# YSK managed vacation for @${domainName}`,
            `# written ≠ Dovecot active until applySystem + .dovecot.sieve`,
            `vacation :days 1 :subject ${JSON.stringify(subject)} ${JSON.stringify(body)};`,
            '',
          ].join('\n')
        : [
            `# YSK vacation disabled for @${domainName}`,
            '# autoreply_enabled=false — no vacation action',
            '',
          ].join('\n');
      writeFileSync(sievePath, content, 'utf8');
      written.push(sievePath);
      notes.push(
        enabled
          ? tl('notes.auto.t0091', { v0: (sievePath) })
          : tl('notes.auto.t0092', { v0: (sievePath) }),
      );
      notes.push(
        tl('notes.auto.n1336'),
      );
    }

    if (this.dataDir && patch.suspended !== undefined) {
      const domainName = String(row.domain);
      const flagDir = join(this.dataDir, 'email', domainName);
      mkdirSync(flagDir, { recursive: true });
      const flagPath = join(flagDir, 'SUSPENDED.flag');
      if (patch.suspended) {
        writeFileSync(
          flagPath,
          [
            `domain=${domainName}`,
            `suspended_at=${new Date().toISOString()}`,
            'status=written',
            'note=Use applySystem to install Postfix REJECT map',
            '',
          ].join('\n'),
          'utf8',
        );
        written.push(flagPath);
        notes.push(tl('notes.tpl.wrote', { path: flagPath }));
      } else if (existsSync(flagPath)) {
        unlinkSync(flagPath);
        notes.push(tl('notes.tpl.removed', { name: flagPath }));
      } else {
        notes.push(tl('notes.auto.n0832'));
      }
    }

    if (patch.rateLimitPerHour !== undefined || patch.antispam !== undefined) {
      notes.push(
        tl('notes.auto.n1533'),
      );
    }

    // Per-mailbox vacation copies (written)
    if (
      this.dataDir &&
      (patch.autoreplyEnabled !== undefined ||
        patch.autoreplySubject !== undefined ||
        patch.autoreplyBody !== undefined)
    ) {
      const { writeMailboxVacationCopies } = await import('./domain-flags-apply.js');
      const locals = this.listMailboxes(domainId).map((m) => {
        const addr = String(m.address ?? '');
        return addr.split('@')[0] ?? '';
      }).filter(Boolean);
      const copies = writeMailboxVacationCopies({
        dataDir: this.dataDir,
        domain: String(row.domain),
        mailboxes: locals,
        enabled: Boolean(row.autoreply_enabled) });
      written.push(...copies.written);
      notes.push(...copies.notes);
    }

    // Always rebuild aggregate suspend map under dataDir
    if (this.dataDir && patch.suspended !== undefined) {
      const { rebuildSuspendDomainMap } = await import('./domain-flags-apply.js');
      const map = rebuildSuspendDomainMap(this.dataDir);
      written.push(map.path);
      notes.push(...map.notes);
    }

    let apply_status: 'written' | 'applied' | 'partial' | 'blocked' = 'written';
    let ok = true;
    let blocked: boolean | undefined;
    let blockMessage: string | undefined;
    let commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }> | undefined;

    const wantSystem = patch.applySystem === true;
    const touchesLive =
      patch.suspended !== undefined ||
      patch.autoreplyEnabled !== undefined ||
      patch.autoreplySubject !== undefined ||
      patch.autoreplyBody !== undefined;

    if (wantSystem && touchesLive && this.dataDir) {
      const { applyDomainFlagsToSystem } = await import('./domain-flags-apply.js');
      const locals = this.listMailboxes(domainId)
        .map((m) => {
          const addr = String(m.address ?? '');
          return addr.split('@')[0] ?? '';
        })
        .filter(Boolean);
      const sys = await applyDomainFlagsToSystem({
        host: this.host,
        dataDir: this.dataDir,
        domain: String(row.domain),
        mailboxes: locals,
        suspended: Boolean(row.suspended),
        vacationEnabled: Boolean(row.autoreply_enabled),
        applySuspend: patch.suspended !== undefined,
        applyVacation:
          patch.autoreplyEnabled !== undefined ||
          patch.autoreplySubject !== undefined ||
          patch.autoreplyBody !== undefined });
      notes.push(...sys.notes);
      written.push(...sys.written);
      commandResults = sys.commandResults;
      apply_status = sys.apply_status;
      ok = sys.ok;
      blocked = sys.blocked;
      blockMessage = sys.blockMessage;
    } else {
      notes.push(
        wantSystem && !touchesLive
          ? tl('notes.auto.n0223')
          : tl('notes.auto.n0224'),
      );
    }

    this.audit?.append({
      actor,
      action: 'email.domain.flags',
      resource: domainId,
      detail: { patch, written, apply_status, ok, blocked },
      ok });
    return {
      domain: { ...row, dkim_private_key: '***redacted***' },
      ok,
      notes,
      written,
      apply_status,
      blocked,
      blockMessage,
      commandResults };
  }

  private rewriteVirtualAliasMap(domainId: string): { written: string[]; notes: string[] } {
    const written: string[] = [];
    const notes: string[] = [];
    if (!this.dataDir) {
      notes.push(tl('notes.auto.n1074'));
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
    notes.push(tl('notes.auto.t0093', { v0: (path), v1: (lines.length) }));
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
      at: new Date().toISOString() };
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
        ok: false });
      return {
        ok: false,
        plan,
        result: {
          error: tl('notes.auto.n1166'),
          domain: row.domain } };
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
      ok });
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
