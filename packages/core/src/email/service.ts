/**
 * Email domain management: real DKIM keygen + durable checklist/health.
 */

import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { EmailDnsRecord, EmailExternalTodo, EmailHealthReport } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import {
  buildExternalTodos,
  generateEmailDnsRecords,
  planEmailStackInstall,
  planTestSend,
  scoreEmailHealth,
} from './dns-records.js';
import type { YskDatabase } from '../db/database.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import type { HostExecutor } from '../host/executor.js';

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
  ) {}

  list(): EmailDomainRecord[] {
    return domains(this.db).map((e) => ({ ...e }));
  }

  get(id: string): EmailDomainRecord {
    const row = domains(this.db).find((e) => e.id === id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `Email domain not found: ${id}`, { httpStatus: 404 });
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
      throw new YskError(ErrorCodes.VALIDATION, `Domain already registered: ${domain}`, {
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
      throw new YskError(ErrorCodes.NOT_FOUND, `Email domain not found: ${id}`, { httpStatus: 404 });
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
   * Record mailbox plan; with root+EXECUTE attempt useradd-style note or local entry.
   */
  createMailbox(
    domainId: string,
    input: { localPart: string; actor: string },
  ): {
    ok: boolean;
    mailbox: Record<string, unknown>;
    notes: string[];
    requiresExecute: boolean;
  } {
    const row = this.get(domainId);
    const local = input.localPart.trim().toLowerCase();
    if (!/^[a-z0-9._+-]{1,64}$/.test(local)) {
      throw new YskError(ErrorCodes.VALIDATION, 'Invalid mailbox local part', { httpStatus: 400 });
    }
    const address = `${local}@${row.domain}`;
    const mailbox = {
      id: randomUUID(),
      domain_id: domainId,
      domain: row.domain,
      local_part: local,
      address,
      status: this.host.executeEnabled() && this.host.isRoot() ? 'planned_system' : 'planned',
      created_at: new Date().toISOString(),
    };
    this.db.snapshot.mailboxes.unshift(mailbox);
    this.db.persist();
    const notes = [
      `Mailbox ${address} recorded`,
      this.host.executeEnabled() && this.host.isRoot()
        ? 'Production: create system/vmail user via email stack apply + user provisioning'
        : 'Planned only — set YSK_EXECUTE=1 + root to provision system mail users',
    ];
    this.audit?.append({
      actor: input.actor,
      action: 'email.mailbox.create',
      resource: address,
      detail: mailbox,
      ok: true,
    });
    return {
      ok: true,
      mailbox,
      notes,
      requiresExecute: !(this.host.executeEnabled() && this.host.isRoot()),
    };
  }

  listMailboxes(domainId?: string): Array<Record<string, unknown>> {
    const all = this.db.snapshot.mailboxes;
    if (!domainId) return all.map((m) => ({ ...m }));
    return all.filter((m) => m.domain_id === domainId).map((m) => ({ ...m }));
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
          error: 'Set YSK_EXECUTE=1 and install sendmail/postfix to send real test mail',
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

export { generateEmailDnsRecords };
