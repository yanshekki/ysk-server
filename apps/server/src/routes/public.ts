/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  CLI_NAME,
  PRODUCT_NAME,
  type HealthResponse,  tl} from 'ysk-server-shared';
import {
  assessProductionReadiness,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import { resolveWebRoot } from '../http/static.js';
import { VERSION } from '../version.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handlePublicRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  const webRoot = resolveWebRoot(ctx.webRoot);
      if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/v1/health')) {
        const executeEnabled = ctx.host.executeEnabled();
        const isRoot = ctx.host.isRoot();
        let authed = false;
        try {
          ctx.auth.authenticate(getBearer(req));
          authed = true;
        } catch {
          /* public liveness only */
        }
        const body: HealthResponse = {
          status: ctx.protection.mode === 'normal' ? 'ok' : 'degraded',
          product: PRODUCT_NAME,
          version: ctx.version || VERSION,
          protectionMode: ctx.protection.mode,
          timestamp: new Date().toISOString(),
        };
        if (authed) {
          body.executeEnabled = executeEnabled;
          body.isRoot = isRoot;
          body.mode = executeEnabled && isRoot ? 'production_capable' : 'degraded';
        }
        sendJson(res, 200, body);
        return true;
      }
      if (
        method === 'GET' &&
        (url.pathname === '/mail/config-v1.1.xml' ||
          url.pathname === '/.well-known/autoconfig/mail/config-v1.1.xml' ||
          url.pathname === '/autodiscover/autodiscover.xml' ||
          url.pathname.toLowerCase() === '/autodiscover/autodiscover.xml')
      ) {
        const { renderMozillaAutoconfig, renderOutlookAutodiscover } = await import('ysk-server-core');
        let domain =
          url.searchParams.get('domain')?.trim().toLowerCase() ||
          url.searchParams.get('emailaddress')?.split('@')[1]?.toLowerCase() ||
          url.searchParams.get('email')?.split('@')[1]?.toLowerCase() ||
          '';
        if (!domain) {
          // Outlook sometimes POSTs; GET with empty → 400
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('domain or email query required');
          return true;
        }
        const known = ctx.email.list().find((d) => d.domain === domain);
        const mailHost = known?.mail_hostname || `mail.${domain}`;
        if (url.pathname.includes('autodiscover')) {
          const email =
            url.searchParams.get('email') ||
            url.searchParams.get('emailaddress') ||
            `user@${domain}`;
          const xml = renderOutlookAutodiscover({
            domain,
            email,
            imapHost: mailHost,
            smtpHost: mailHost,
          });
          res.writeHead(200, {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          });
          res.end(xml);
          return true;
        }
        const xml = renderMozillaAutoconfig({
          domain,
          imapHost: mailHost,
          smtpHost: mailHost,
        });
        res.writeHead(200, {
          'Content-Type': 'text/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        });
        res.end(xml);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/status') {
        // Public liveness only — host paths / execute / tools require auth
        let authed = false;
        try {
          ctx.auth.authenticate(getBearer(req));
          authed = true;
        } catch {
          /* public subset */
        }
        if (!authed) {
          sendJson(res, 200, {
            product: PRODUCT_NAME,
            cli: CLI_NAME,
            version: VERSION,
            startedAt: ctx.startedAt,
            webUi: Boolean(webRoot),
            ok: true,
          });
          return true;
        }
        sendJson(res, 200, {
          product: PRODUCT_NAME,
          cli: CLI_NAME,
          version: VERSION,
          startedAt: ctx.startedAt,
          protection: ctx.protection,
          dataDir: ctx.dataDir,
          executeEnabled: ctx.host.executeEnabled(),
          isRoot: ctx.host.isRoot(),
          webUi: Boolean(webRoot),
          webRoot: webRoot ?? null,
          mode: ctx.host.executeEnabled() && ctx.host.isRoot() ? 'production_capable' : 'degraded',
          tools: ctx.allowlist.list().map((t) => t.tool),
        });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/readiness') {
        let authed = false;
        try {
          ctx.auth.authenticate(getBearer(req));
          authed = true;
        } catch {
          /* install probe: boolean only, no host inventory */
        }
        const projects = authed
          ? ctx.projects.list().map((p) => ({
              id: p.id,
              name: p.name,
              linuxUser: p.linuxUser,
              homeDir: p.homeDir,
              osProvisioned: Boolean(p.osProvisioned),
            }))
          : [];
        const report = await assessProductionReadiness({
          dataDir: ctx.dataDir,
          host: ctx.host,
          product: PRODUCT_NAME,
          version: VERSION,
          projects,
        });
        if (!authed) {
          sendJson(res, report.productionReady ? 200 : 503, {
            ok: report.productionReady,
            productionReady: report.productionReady,
            product: PRODUCT_NAME,
            version: VERSION,
          });
          return true;
        }
        sendJson(res, report.productionReady ? 200 : 503, report);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/health$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.health(id);
        sendJson(res, result.ok ? 200 : 503, result);
        return true;
      }
      if (
        method === 'GET' &&
        url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/autodiscover$/)
      ) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const d = ctx.email.get(id);
        const { renderMozillaAutoconfig, renderOutlookAutodiscover } = await import('ysk-server-core');
        sendJson(res, 200, {
          domain: d.domain,
          mailHostname: d.mail_hostname,
          mozillaXml: renderMozillaAutoconfig({
            domain: d.domain,
            imapHost: d.mail_hostname,
            smtpHost: d.mail_hostname,
          }),
          outlookXml: renderOutlookAutodiscover({
            domain: d.domain,
            imapHost: d.mail_hostname,
            smtpHost: d.mail_hostname,
          }),
          urls: {
            mozilla: `https://autoconfig.${d.domain}/mail/config-v1.1.xml`,
            outlook: `https://autodiscover.${d.domain}/autodiscover/autodiscover.xml`,
          },
          notes: [
            tl('notes.auto.n1399'),
            `IMAP/SMTP: ${d.mail_hostname}`,
          ],
        });
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/health-loop$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { applyZone?: boolean };
        const { runCdnSiteHealthLoop } = await import('ysk-server-core');
        const r = await runCdnSiteHealthLoop({
          db: ctx.db,
          dataDir: ctx.dataDir,
          siteId: id,
          host: ctx.host,
          applyZone: data.applyZone,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.health_loop',
          resource: id,
          detail: {
            ok: r.ok,
            strategy: r.strategy,
            ipv4: r.selectedIpv4,
          },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
  return false;
}
