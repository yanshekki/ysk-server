/**
 * Spec §5 one-click Email Server bootstrap (guided).
 * Combines: domain DKIM create + MTA configs + passdb + webmail plan.
 * System package install remains dual-mode (root + YSK_EXECUTE).
 */

import type { HostExecutor } from '../host/executor.js';
import type { YskDatabase } from '../db/database.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import { EmailService } from './service.js';
import { applyEmailStack } from '../hosting/system-apply.js';
import { writeDovecotPassdb } from './dovecot-passdb.js';
import { applyWebmail } from './webmail-apply.js';
import { applySmtpRelay } from './relay.js';
import { ErrorCodes, YskError, tl} from '@ysk/shared';

export interface EmailBootstrapResult {
  ok: boolean;
  domainId: string;
  domain: string;
  steps: Array<{ id: string; ok: boolean; detail: string }>;
  notes: string[];
  written: string[];
  requiresExecute: boolean;
  requiresRoot: boolean;
  externalTodos: Array<{ id: string; title: string; description: string }>;
}

/**
 * Bootstrap professional email stack for a domain under dataDir.
 * Never claims external DNS/PTR/Port25 complete.
 */
export async function bootstrapEmailServer(input: {
  dataDir: string;
  db: YskDatabase;
  host: HostExecutor;
  domain: string;
  serverIp: string;
  mailHostname?: string;
  actor: string;
  audit?: AuditRepository;
  /** Attempt apt/system install of postfix stack */
  installPackages?: boolean;
  /** Optional first mailbox local part */
  adminLocalPart?: string;
  adminPassword?: string;
  /** Optional SMTP relay when Port 25 blocked */
  relay?: {
    host: string;
    port?: number;
    username?: string;
    password?: string;
  };
  /** Also write webmail plan for webmail.<domain> */
  webmail?: boolean;
}): Promise<EmailBootstrapResult> {
  const domain = input.domain.trim().toLowerCase();
  if (!domain) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.needDomain'), { httpStatus: 400 });
  }
  if (!input.serverIp?.trim()) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.needServerIp'), { httpStatus: 400 });
  }

  const email = new EmailService(input.db, input.host, input.audit, input.dataDir);
  const steps: EmailBootstrapResult['steps'] = [];
  const notes: string[] = [];
  const written: string[] = [];
  let domainId = '';

  // 1. Domain + DKIM
  try {
    const existing = email.list().find((d) => d.domain === domain);
    if (existing) {
      domainId = existing.id;
      steps.push({ id: 'domain', ok: true, detail: `Reusing domain ${domain}` });
    } else {
      const created = email.create({
        domain,
        serverIp: input.serverIp,
        mailHostname: input.mailHostname,
        actor: input.actor });
      domainId = created.domain.id;
      steps.push({
        id: 'domain',
        ok: true,
        detail: `Created domain with DKIM selector ${created.domain.dkim_selector ?? 'default'}` });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push({ id: 'domain', ok: false, detail: msg });
    return {
      ok: false,
      domainId,
      domain,
      steps,
      notes: [msg],
      written,
      requiresExecute: !input.host.executeEnabled(),
      requiresRoot: !input.host.isRoot(),
      externalTodos: [] };
  }

  // 2. MTA configs under dataDir
  const mta = await applyEmailStack({
    dataDir: input.dataDir,
    domain,
    mailHostname: input.mailHostname,
    host: input.host,
    installPackages: input.installPackages });
  written.push(...mta.written);
  notes.push(...mta.notes);
  steps.push({
    id: 'mta-configs',
    ok: mta.ok,
    detail: mta.ok
      ? `MTA configs written (${mta.written.length} files)`
      : `MTA install incomplete: ${mta.notes.filter((n) => /skip|YSK_EXECUTE|fail/i.test(n)).join('; ') || 'see notes'}` });

  // 3. Optional admin mailbox
  if (input.adminLocalPart) {
    try {
      const mb = await email.createMailbox(domainId, {
        localPart: input.adminLocalPart,
        password: input.adminPassword,
        actor: input.actor });
      written.push(...mb.written);
      notes.push(...mb.notes);
      steps.push({
        id: 'mailbox',
        ok: mb.ok,
        detail: `Mailbox ${String(mb.mailbox.address)} status=${String(mb.mailbox.status)}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // already exists is soft-ok
      const soft = /already exists/i.test(msg);
      steps.push({ id: 'mailbox', ok: soft, detail: msg });
    }
  }

  // 4. Dovecot passdb
  try {
    const pd = writeDovecotPassdb({
      dataDir: input.dataDir,
      db: input.db,
      domain,
      domainId });
    written.push(...pd.written);
    notes.push(...pd.notes);
    steps.push({
      id: 'dovecot-passdb',
      ok: pd.ok,
      detail: `Passdb mailboxes=${pd.mailboxCount}` });
  } catch (e) {
    steps.push({
      id: 'dovecot-passdb',
      ok: false,
      detail: e instanceof Error ? e.message : String(e) });
  }

  // 5. Optional relay
  if (input.relay?.host) {
    const relay = await applySmtpRelay({
      dataDir: input.dataDir,
      host: input.host,
      relay: {
        host: input.relay.host,
        port: input.relay.port ?? 587,
        username: input.relay.username,
        password: input.relay.password,
        security: 'starttls',
        domain },
      applySystem: Boolean(input.installPackages),
      db: input.db,
      actor: input.actor });
    written.push(...relay.written);
    notes.push(...relay.notes);
    steps.push({
      id: 'smtp-relay',
      ok: relay.ok,
      detail: relay.appliedToSystem
        ? tl('notes.auto.n0502')
        : tl('notes.auto.n0503') });
  }

  // 6. Webmail plan
  if (input.webmail !== false) {
    const wm = await applyWebmail({
      dataDir: input.dataDir,
      host: input.host,
      domain: `webmail.${domain}`,
      imapHost: input.mailHostname ?? `mail.${domain}`,
      smtpHost: input.mailHostname ?? `mail.${domain}`,
      download: false });
    written.push(...wm.written);
    notes.push(...wm.notes);
    steps.push({
      id: 'webmail',
      ok: wm.ok,
      detail: `Webmail ${wm.mode} for webmail.${domain}` });
  }

  const bundle = email.getDnsBundle(domainId);
  notes.push(
    'EXTERNAL (operator-owned): set MX/SPF/DKIM/DMARC at DNS provider; PTR at VPS; Port 25 or relay',
  );
  notes.push(
    `Health score now ${bundle.health.score}/${bundle.health.maxScore} (DNS/PTR/Port25 not auto-complete)`,
  );

  input.audit?.append({
    actor: input.actor,
    action: 'email.bootstrap',
    resource: domain,
    detail: {
      domainId,
      steps,
      installPackages: Boolean(input.installPackages) },
    ok: steps.every((s) => s.ok) });

  const ok = steps.every((s) => s.ok);
  return {
    ok,
    domainId,
    domain,
    steps,
    notes,
    written: [...new Set(written)],
    requiresExecute: !input.host.executeEnabled(),
    requiresRoot: !input.host.isRoot(),
    externalTodos: bundle.externalTodos.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description })) };
}
