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
import {
  createWebmailProject,
  defaultWebmailHostname,
  defaultWebmailProjectName,
  type WebmailTool,
} from './webmail-project.js';
import { applySmtpRelay } from './relay.js';
import { ErrorCodes, YskError, tl } from '@ysk/shared';
import type { ProjectService } from '../hosting/project-service.js';
import type { ProjectOpsService } from '../hosting/project-ops.js';

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
  /** Set when webmail project path used */
  webmailProjectId?: string;
  webmailUrlHint?: string;
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
  /** Also create webmail (PHP project when projects provided) */
  webmail?: boolean;
  /** Prefer project lifecycle (Adminer model). Requires projects + projectOps. */
  projects?: ProjectService;
  projectOps?: ProjectOpsService;
  actorUserId?: string;
  webmailTool?: WebmailTool;
  /** Download Roundcube/SnappyMail during bootstrap (needs YSK_EXECUTE) */
  webmailDownload?: boolean;
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
      ? tl('email.bootstrap.mtaOk', { count: mta.written.length })
      : tl('email.bootstrap.mtaIncomplete', {
          detail:
            mta.notes.filter((n) => /skip|YSK_EXECUTE|fail|權限|root/i.test(n)).join('; ') ||
            tl('email.bootstrap.seeNotes'),
        }),
  });

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
        detail: tl('email.bootstrap.mailboxOk', {
          address: String(mb.mailbox.address),
          status: String(mb.mailbox.status),
        }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // already exists is soft-ok
      const soft = /already exists|已存在/i.test(msg);
      steps.push({
        id: 'mailbox',
        ok: soft,
        detail: soft ? tl('email.bootstrap.mailboxExists', { detail: msg }) : msg,
      });
    }
  }

  // 4. Dovecot passdb + install into live Dovecot
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
      detail: tl('email.bootstrap.passdbOk', { count: pd.mailboxCount }),
    });
    if (input.host.executeEnabled() && input.host.isRoot()) {
      const { applyDovecotPassdbToSystem } = await import('./dovecot-passdb.js');
      const ap = await applyDovecotPassdbToSystem({
        dataDir: input.dataDir,
        host: input.host,
        db: input.db,
        rewritePassdbs: false,
      });
      written.push(...ap.written);
      notes.push(...ap.notes);
      steps.push({
        id: 'dovecot-apply',
        ok: ap.ok,
        detail: ap.ok ? tl('email.bootstrap.dovecotApplyOk') : ap.notes.join('; ').slice(0, 200),
      });
    } else {
      steps.push({
        id: 'dovecot-apply',
        ok: false,
        detail: tl('notes.email.dovecotPassdbWrittenNeedApply'),
      });
    }
  } catch (e) {
    steps.push({
      id: 'dovecot-passdb',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
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

  // 6. Webmail — PHP project path when projects available (same as Adminer/PMA)
  let webmailProjectId: string | undefined;
  let webmailUrlHint: string | undefined;
  if (input.webmail !== false) {
    const wmHost = defaultWebmailHostname(domain);
    const imapHost = input.mailHostname ?? `mail.${domain}`;
    if (input.projects && input.projectOps) {
      const tool = input.webmailTool ?? 'roundcube';
      const wm = await createWebmailProject({
        projects: input.projects,
        projectOps: input.projectOps,
        host: input.host,
        actor: input.actor,
        actorUserId: input.actorUserId,
        name: defaultWebmailProjectName(tool, domain),
        domain: wmHost,
        tool,
        mailDomain: domain,
        imapHost,
        smtpHost: imapHost,
        download: input.webmailDownload !== false,
        installSsoPlugin: tool === 'roundcube',
        forceHttps: false,
      });
      written.push(...wm.written);
      notes.push(...wm.notes);
      webmailProjectId = wm.projectId;
      webmailUrlHint = wm.urlHint;
      steps.push({
        id: 'webmail',
        ok: wm.ok || wm.apply_status === 'written',
        detail: tl('email.bootstrap.webmailProjectOk', {
          tool,
          host: wmHost,
          status: wm.apply_status,
        }),
      });
      if (wm.requiresExecute) {
        notes.push(tl('notes.webmail.needExecute'));
      }
    } else {
      // Legacy skeleton only (CLI without project service)
      const wm = await applyWebmail({
        dataDir: input.dataDir,
        host: input.host,
        domain: wmHost,
        imapHost,
        smtpHost: imapHost,
        download: false,
      });
      written.push(...wm.written);
      notes.push(...wm.notes);
      notes.push(tl('notes.webmail.bootstrapLegacyHint'));
      steps.push({
        id: 'webmail',
        ok: wm.ok,
        detail: tl('email.bootstrap.webmailOk', {
          mode: wm.mode,
          host: wmHost,
        }),
      });
    }
  }

  // Honesty: mail TLS is separate — cert issue + path apply are operator steps
  notes.push(
    tl('email.bootstrap.mailTlsTodo', {
      mailHost: input.mailHostname ?? `mail.${domain}`,
    }),
  );

  const bundle = email.getDnsBundle(domainId);
  notes.push(tl('email.bootstrap.externalDns'));
  notes.push(
    tl('email.bootstrap.healthScore', {
      score: bundle.health.score,
      max: bundle.health.maxScore,
    }),
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
    webmailProjectId,
    webmailUrlHint,
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
