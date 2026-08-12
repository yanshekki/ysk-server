/**
 * Email webmail apply / project create (Wave W1).
 * Extracted from email-webmail.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyWebmail } from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendOpsResult,
} from '../http/util.js';

export async function handleEmailWebmailApplyRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/email/webmail/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      imapHost?: string;
      smtpHost?: string;
      download?: boolean;
      systemInstall?: boolean;
      /** Create PHP project + goLive (Adminer/phpMyAdmin model). Default when tool/projectName set. */
      asProject?: boolean;
      projectName?: string;
      tool?: 'roundcube' | 'snappymail';
      mailDomain?: string;
      reinstall?: boolean;
      projectId?: string;
      forceHttps?: boolean;
      installSsoPlugin?: boolean;
      panelBaseUrl?: string;
    };
    const useProject =
      data.asProject === true ||
      Boolean(data.projectName?.trim()) ||
      Boolean(data.projectId?.trim()) ||
      data.reinstall === true ||
      data.tool === 'snappymail' ||
      data.tool === 'roundcube';
    if (useProject) {
      const {
        createWebmailProject,
        reinstallWebmailProject,
        normalizeWebmailTool,
        defaultWebmailProjectName,
        defaultWebmailHostname,
      } = await import('ysk-server-core');
      const tool = normalizeWebmailTool(data.tool);
      const domain =
        (data.domain ?? '').trim() ||
        defaultWebmailHostname((data.mailDomain ?? 'example.com').trim() || 'example.com');
      // Prefer explicit mailDomain; else strip webmailN. from hostname; else first domain field
      const mailDomainRaw = (data.mailDomain ?? '').trim().toLowerCase();
      const mailDomain =
        mailDomainRaw && !/^webmail\d*\./i.test(mailDomainRaw)
          ? mailDomainRaw
          : (domain.match(/^webmail\d*\.(.+)$/i)?.[1] || mailDomainRaw || undefined);
      const name =
        (data.projectName ?? '').trim() ||
        defaultWebmailProjectName(tool, mailDomain || domain);
      const panelBaseUrl =
        data.panelBaseUrl?.trim() ||
        `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host ?? '127.0.0.1'}`;
      // Prefer mail.<apex> when client omitted imapHost
      const imapHost =
        data.imapHost?.trim() ||
        (mailDomain ? `mail.${mailDomain}` : undefined);
      const smtpHost = data.smtpHost?.trim() || imapHost;
      const result = data.projectId?.trim()
        ? await reinstallWebmailProject({
            projects: ctx.projects,
            projectOps: ctx.projectOps,
            host: ctx.host,
            actor: user.username,
            projectId: data.projectId.trim(),
            tool,
            download: data.download !== false,
            imapHost,
            smtpHost,
            mailDomain: mailDomain || undefined,
            forceHttps: data.forceHttps === true,
            installSsoPlugin: data.installSsoPlugin !== false,
            panelBaseUrl,
            goLive: true,
          })
        : await createWebmailProject({
            projects: ctx.projects,
            projectOps: ctx.projectOps,
            host: ctx.host,
            actor: user.username,
            actorUserId: user.id,
            name,
            domain,
            tool,
            download: data.download !== false,
            imapHost,
            smtpHost,
            mailDomain: mailDomain || undefined,
            reinstall: data.reinstall === true,
            forceHttps: data.forceHttps === true,
            installSsoPlugin: data.installSsoPlugin !== false,
            panelBaseUrl,
          });
      ctx.audit.append({
        actor: user.username,
        action: data.reinstall || data.projectId
          ? 'email.webmail.reinstall'
          : 'email.webmail.project_create',
        resource: result.projectId,
        detail: { tool, name, domain, ok: result.ok },
        ok: result.ok,
      });
      sendOpsResult(res, result);
      return true;
    }
    // Legacy: dataDir skeleton + optional tarball (no PHP project)
    const result = await applyWebmail({
      dataDir: ctx.dataDir,
      host: ctx.host,
      domain: data.domain ?? 'webmail.example.com',
      imapHost: data.imapHost,
      smtpHost: data.smtpHost,
      download: data.download,
      systemInstall: data.systemInstall,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'email.webmail.apply',
      resource: result.domain,
      detail: { mode: result.mode, ok: result.ok },
      ok: result.ok,
    });
    // plan-only is ok:true with mode plan; refused is ok:false
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
