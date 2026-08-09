import { tl } from '@ysk/shared';
/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  writeAllDovecotPassdbs,
  applyWebmail,
  bootstrapEmailServer,
  checkIpDnsbl,
  planEmailWarmup,
  applySmtpRelay,
  loadSmtpRelaySettings,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';
import { handleEmailDomainsRoutes } from './email-domains.js';

export async function handleEmailRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'POST' && url.pathname === '/api/v1/email/relay') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          host?: string;
          port?: number;
          username?: string;
          password?: string;
          security?: 'none' | 'starttls' | 'tls';
          domain?: string;
          applySystem?: boolean;
        };
        const result = await applySmtpRelay({
          dataDir: ctx.dataDir,
          host: ctx.host,
          relay: {
            host: data.host ?? '',
            port: data.port ?? 587,
            username: data.username,
            password: data.password,
            security: data.security ?? 'starttls',
            domain: data.domain,
          },
          applySystem: data.applySystem,
          db: ctx.db,
          actor: user.username,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.relay.apply',
          detail: { ...result, config: result.config },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/email/relay') {
        ctx.auth.authenticate(getBearer(req));
        const stored = ctx.settings.get('email.smtp_relay');
        sendJson(res, 200, {
          settings: stored ? JSON.parse(stored) : null,
          files: loadSmtpRelaySettings(ctx.dataDir),
        });
        return true;
      }
      // domains CRUD + per-domain ops → email-domains.ts (Wave I1)
      if (await handleEmailDomainsRoutes(ctx, req, res, url, method)) return true;

      if (method === 'GET' && url.pathname === '/api/v1/email/queue') {
        ctx.auth.authenticate(getBearer(req));
        const { listMailQueue } = await import('@ysk/core');
        sendJson(res, 200, await listMailQueue(ctx.host));
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/queue/flush') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { id?: string; all?: boolean };
        const { flushMailQueue } = await import('@ysk/core');
        const r = await flushMailQueue(ctx.host, data);
        ctx.audit.append({
          actor: user.username,
          action: 'email.queue.flush',
          detail: data,
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/email/mailboxes') {
        ctx.auth.authenticate(getBearer(req));
        const domainId = (url.searchParams.get('domainId') ?? '').trim();
        type Mb = Record<string, unknown>;
        let all = ctx.email.listMailboxes() as unknown as Mb[];
        if (domainId) {
          all = all.filter(
            (m: Mb) =>
              String(m.domain_id ?? m.domainId ?? '') === domainId ||
              String(m.domain ?? '') === domainId,
          );
        }
        const { items, meta } = listWithQuery(url, all, {
          text: (m: Mb) => [
            String(m.local_part ?? m.localPart ?? ''),
            String(m.address ?? ''),
            String(m.domain ?? ''),
            String(m.id ?? ''),
          ],
        });
        sendJson(res, 200, { items, meta });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/dovecot-passdb/all') {
        const user = ctx.auth.authenticate(getBearer(req));
        const result = writeAllDovecotPassdbs({ dataDir: ctx.dataDir, db: ctx.db });
        ctx.audit.append({
          actor: user.username,
          action: 'email.dovecot_passdb.all',
          detail: { domains: result.domains.length },
          ok: result.ok !== false,
        });
        sendOpsResult(res, result);
        return true;
      }
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
          } = await import('@ysk/core');
          const tool = normalizeWebmailTool(data.tool);
          const mailDomain = (data.mailDomain ?? data.domain ?? '').trim();
          const domain =
            (data.domain ?? '').trim() ||
            defaultWebmailHostname(mailDomain || 'example.com');
          const name =
            (data.projectName ?? '').trim() ||
            defaultWebmailProjectName(tool, mailDomain || domain);
          const panelBaseUrl =
            data.panelBaseUrl?.trim() ||
            `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host ?? '127.0.0.1'}`;
          const result = data.projectId?.trim()
            ? await reinstallWebmailProject({
                projects: ctx.projects,
                projectOps: ctx.projectOps,
                host: ctx.host,
                actor: user.username,
                projectId: data.projectId.trim(),
                tool,
                download: data.download !== false,
                imapHost: data.imapHost,
                smtpHost: data.smtpHost,
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
                imapHost: data.imapHost,
                smtpHost: data.smtpHost,
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

      // D7: bind existing LE cert paths into Postfix/Dovecot (does not run certbot)
      if (method === 'POST' && url.pathname === '/api/v1/email/mail-tls/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          mailHost?: string;
          applyDovecot?: boolean;
        };
        const { applyMailTlsPaths } = await import('@ysk/core');
        const result = await applyMailTlsPaths({
          host: ctx.host,
          domain: data.domain ?? '',
          mailHost: data.mailHost,
          applyDovecot: data.applyDovecot,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.mail_tls.apply',
          resource: data.domain,
          detail: { mailHost: result.mailHost, ok: result.ok, applied: result.applied },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/bootstrap') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          serverIp?: string;
          mailHostname?: string;
          installPackages?: boolean;
          adminLocalPart?: string;
          adminPassword?: string;
          webmail?: boolean;
          relay?: {
            host: string;
            port?: number;
            username?: string;
            password?: string;
          };
        };
        const result = await bootstrapEmailServer({
          dataDir: ctx.dataDir,
          db: ctx.db,
          host: ctx.host,
          domain: data.domain ?? '',
          serverIp: data.serverIp ?? '',
          mailHostname: data.mailHostname,
          actor: user.username,
          actorUserId: user.id,
          audit: ctx.audit,
          installPackages: data.installPackages,
          adminLocalPart: data.adminLocalPart,
          adminPassword: data.adminPassword,
          webmail: data.webmail,
          relay: data.relay,
          projects: ctx.projects,
          projectOps: ctx.projectOps,
          webmailDownload: true,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/webmail/sso') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          email?: string;
          domain?: string;
          ttlMinutes?: number;
          password?: string;
          webmailBaseUrl?: string;
        };
        const { issueWebmailSso } = await import('@ysk/core');
        const r = issueWebmailSso({
          db: ctx.db,
          email: data.email ?? '',
          domain: data.domain ?? '',
          ttlMinutes: data.ttlMinutes,
          password: data.password,
          webmailBaseUrl: data.webmailBaseUrl,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.webmail.sso',
          resource: data.email,
          detail: { ok: r.ok, expiresAt: r.expiresAt, hasPassword: Boolean(data.password) },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/webmail/sso/consume') {
        // Used by webmail edge / test — token in body; rate-limit guesses
        const { checkRateLimit, recordRateLimitFailure, clearRateLimit, consumeWebmailSso } =
          await import('@ysk/core');
        const ip =
          process.env.YSK_TRUST_PROXY === '1' || process.env.YSK_TRUST_PROXY === 'true'
            ? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
              req.socket.remoteAddress ||
              'local'
            : req.socket.remoteAddress || 'local';
        const rlKey = `sso:${ip}`;
        const gate = checkRateLimit('webmail-sso', rlKey, {
          maxFailures: 20,
          windowMs: 15 * 60_000,
          lockMs: 15 * 60_000,
        });
        if (!gate.ok) {
          sendJson(res, 429, {
            ok: false,
            message: 'rate limited',
            retryAfterSec: gate.retryAfterSec,
          });
          return true;
        }
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { token?: string };
        const r = consumeWebmailSso(ctx.db, data.token ?? '');
        if (!r.ok) recordRateLimitFailure('webmail-sso', rlKey);
        else clearRateLimit('webmail-sso', rlKey);
        // Unauthorized token → 401 (not ops blocked); success still honest envelope
        if (!r.ok) {
          sendJson(res, 401, { ok: false, notes: r.notes, code: 'YSK_UNAUTHORIZED' });
          return true;
        }
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/email/sieve') {
        ctx.auth.authenticate(getBearer(req));
        const mailbox = url.searchParams.get('mailbox') ?? '';
        const { listSieveScripts } = await import('@ysk/core');
        sendJson(res, 200, { items: listSieveScripts(ctx.dataDir, mailbox) });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/sieve') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          mailbox?: string;
          name?: string;
          content?: string;
        };
        const { writeSieveScript } = await import('@ysk/core');
        const r = writeSieveScript({
          dataDir: ctx.dataDir,
          mailbox: data.mailbox ?? '',
          name: data.name,
          content: data.content ?? '',
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.sieve.write',
          resource: data.mailbox,
          detail: r,
          ok: r.ok,
        });
        sendJson(res, 200, r);
        return true;
      }
      if (method === 'DELETE' && url.pathname === '/api/v1/email/sieve') {
        const user = ctx.auth.authenticate(getBearer(req));
        const mailbox = url.searchParams.get('mailbox') ?? '';
        const name = url.searchParams.get('name') ?? '';
        const { deleteSieveScript } = await import('@ysk/core');
        const r = deleteSieveScript(ctx.dataDir, mailbox, name);
        ctx.audit.append({
          actor: user.username,
          action: 'email.sieve.delete',
          resource: mailbox,
          detail: r,
          ok: r.ok,
        });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/dnsbl/multi') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { ips?: string[] };
        const { checkMultipleIpsDnsbl } = await import('@ysk/core');
        const r = await checkMultipleIpsDnsbl(data.ips ?? []);
        sendJson(res, 200, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/webmail/sso-plugin') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          panelBaseUrl?: string;
          enableSystem?: boolean;
          roundcubePluginsDir?: string;
        };
        const panelBase =
          data.panelBaseUrl || `http://127.0.0.1:${process.env.YSK_PORT || process.env.PORT || 9287}`;
        if (data.enableSystem) {
          const { enableRoundcubeSsoPlugin } = await import('@ysk/core');
          const r = await enableRoundcubeSsoPlugin({
            dataDir: ctx.dataDir,
            host: ctx.host,
            panelBaseUrl: panelBase,
            roundcubePluginsDir: data.roundcubePluginsDir,
          });
          ctx.audit.append({
            actor: user.username,
            action: 'email.webmail.sso_plugin.enable',
            detail: r,
            ok: r.ok,
          });
          sendOpsResult(res, r);
          return true;
        }
        const { writeRoundcubeSsoPlugin } = await import('@ysk/core');
        const r = writeRoundcubeSsoPlugin({
          dataDir: ctx.dataDir,
          panelBaseUrl: panelBase,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.webmail.sso_plugin',
          detail: r,
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/dnsbl/check') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { ip?: string };
        const ip = data.ip?.trim();
        if (!ip) {
          sendJson(res, 400, {
            ok: false,
            code: 'YSK_VALIDATION',
            message: tl('notes.auto.n1400'),
          });
          return true;
        }
        const report = await checkIpDnsbl(ip);
        sendJson(res, 200, report);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/email/dnsbl/last') {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, {
          last: ctx.settings.getJson('last_dnsbl_run') ?? null,
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/warmup') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          serverIp?: string;
          isNewIp?: boolean;
        };
        const plan = planEmailWarmup({
          domain: data.domain ?? 'example.com',
          serverIp: data.serverIp ?? '203.0.113.10',
          isNewIp: data.isNewIp,
        });
        sendJson(res, 200, plan);
        return true;
      }
  return false;
}
