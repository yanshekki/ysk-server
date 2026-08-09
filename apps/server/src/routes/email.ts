import { tl } from '@ysk/shared';
/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeAllDovecotPassdbs, writeDovecotPassdb, applyWebmail, bootstrapEmailServer, checkIpDnsbl, planEmailWarmup, applySmtpRelay, loadSmtpRelaySettings, runLiveEmailChecks } from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

function redactEmail<T extends { dkim_private_key?: string }>(e: T) {
  return { ...e, dkim_private_key: '***redacted***' };
}

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
      if (method === 'GET' && url.pathname === '/api/v1/email/domains') {
        ctx.auth.authenticate(getBearer(req));
        type Dom = {
          domain?: string;
          id?: string;
          server_ip?: string;
          apply_status?: string;
        };
        const all = ctx.email.list().map(redactEmail) as Dom[];
        const { items, meta } = listWithQuery(
          url,
          all,
          {
            text: (d: Dom) => [
              String(d.domain ?? ''),
              String(d.id ?? ''),
              String(d.server_ip ?? ''),
            ],
            predicates: {
              status: (d: Dom, v: string) => {
                const s = String(d.apply_status ?? 'draft').toLowerCase();
                if (v === 'draft') return s === 'draft' || s === 'written' || !s;
                return s === v;
              },
            },
            facetOf: {
              status: (d: Dom) => String(d.apply_status ?? 'draft').toLowerCase() || 'draft',
            },
            sortOf: {
              domain: (a: Dom, b: Dom) =>
                String(a.domain ?? '').localeCompare(String(b.domain ?? '')),
            },
          },
          {
            enums: {
              status: ['applied', 'written', 'draft', 'failed'],
            },
            sortFields: ['domain'],
          },
        );
        sendJson(res, 200, { items, meta });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/domains') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          serverIp?: string;
          serverIpv6?: string;
          mailHostname?: string;
        };
        const created = ctx.email.create({
          domain: data.domain ?? '',
          serverIp: data.serverIp ?? '',
          serverIpv6: data.serverIpv6,
          mailHostname: data.mailHostname,
          actor: user.username,
        });
        sendJson(res, 201, created);
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5] ?? '';
        let body: { confirmName?: string; removeData?: boolean } = {};
        try {
          const raw = await readBody(req);
          if (raw?.trim()) body = JSON.parse(raw) as typeof body;
        } catch {
          body = {};
        }
        if (url.searchParams.has('confirmName')) {
          body.confirmName = url.searchParams.get('confirmName') || undefined;
        }
        if (url.searchParams.has('removeData')) {
          body.removeData = url.searchParams.get('removeData') !== '0';
        }
        const result = ctx.email.deleteDomain(id, user.username, {
          confirmName: body.confirmName,
          removeData: body.removeData !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.domain.delete',
          resource: result.domain,
          detail: {
            id,
            removedMailboxes: result.removedMailboxes,
            removedAliases: result.removedAliases,
            removeData: body.removeData !== false,
          },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
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
      // —— Deliverability ops pack (C3) ——
      if (
        method === 'GET' &&
        url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/deliverability$/)
      ) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const row = ctx.email.get(id);
        const { buildDeliverabilityReport } = await import('@ysk/core');
        const report = await buildDeliverabilityReport({
          domain: row.domain,
          serverIp: row.server_ip,
          serverIpv6: row.server_ipv6,
          mailHostname: row.mail_hostname,
          dkimPublicKey: row.dkim_public_key ?? '',
          dataDir: ctx.dataDir,
          ptrOkStored: row.ptr_ok ?? undefined,
          port25Stored: row.port25_open ?? undefined,
          dnsApplied: row.dns_applied ?? undefined,
          dmarcPresent: row.dmarc_present ?? undefined,
        });
        sendJson(res, 200, report);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/email/deliverability/overview') {
        ctx.auth.authenticate(getBearer(req));
        const { buildDeliverabilityReport } = await import('@ysk/core');
        const domains = ctx.email.list();
        const items = [];
        for (const d of domains.slice(0, 20)) {
          try {
            const report = await buildDeliverabilityReport({
              domain: d.domain,
              serverIp: d.server_ip,
              serverIpv6: d.server_ipv6,
              mailHostname: d.mail_hostname,
              dkimPublicKey: d.dkim_public_key ?? '',
              dataDir: ctx.dataDir,
            });
            items.push({
              domainId: d.id,
              domain: d.domain,
              score: report.score,
              panelReady: report.panelReady,
              deliveryGuaranteed: false as const,
              blocked: report.items.filter((i) => i.ok === false).map((i) => i.id),
            });
          } catch (e) {
            items.push({
              domainId: d.id,
              domain: d.domain,
              score: 0,
              panelReady: false,
              deliveryGuaranteed: false as const,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        sendJson(res, 200, {
          at: new Date().toISOString(),
          items,
          honesty: [
            'Overview is advisory only — never guarantees inbox placement.',
            'PTR and Port 25 remain VPS-provider responsibilities.',
          ],
        });
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/dns$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        sendJson(res, 200, ctx.email.getDnsBundle(id));
        return true;
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/checks$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          dnsApplied?: boolean;
          dmarcPresent?: boolean;
          ptrOk?: boolean;
          port25Open?: boolean | null;
        };
        sendJson(res, 200, ctx.email.updateChecks(id, data, user.username));
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/test-send$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { from?: string; to?: string; subject?: string };
        const result = await ctx.email.testSend(
          id,
          { from: data.from ?? '', to: data.to ?? '', subject: data.subject },
          user.username,
        );
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/mailboxes$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        sendJson(res, 200, { items: ctx.email.listMailboxes(id) });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/mailboxes$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          localPart?: string;
          password?: string;
          provisionSystem?: boolean;
        };
        const result = await ctx.email.createMailbox(id, {
          localPart: data.localPart ?? '',
          password: data.password,
          provisionSystem: data.provisionSystem,
          actor: user.username,
          actorUserId: user.id,
        });
        sendOpsResult(res, result);
        return true;
      }

      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/aliases$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        sendJson(res, 200, { items: ctx.email.listAliases(id) });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/aliases$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          type?: 'alias' | 'forward' | 'catchall';
          localPart?: string;
          destinations?: string[];
        };
        const result = ctx.email.createAlias(id, {
          type: data.type ?? 'forward',
          localPart: data.localPart,
          destinations: data.destinations ?? [],
          actor: user.username });
        sendJson(res, 201, result);
        return true;
      }

      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/flags$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          catchallAddress?: string | null;
          autoreplyEnabled?: boolean;
          autoreplySubject?: string;
          autoreplyBody?: string;
          rateLimitPerHour?: number | null;
          antispam?: boolean;
          suspended?: boolean;
          applySystem?: boolean;
        };
        const result = await ctx.email.updateDomainMailFlags(id, data, user.username);
        sendOpsResult(res, {
          ok: result.ok,
          apply_status: result.apply_status,
          notes: result.notes,
          written: result.written,
          blocked: result.blocked,
          blockMessage: result.blockMessage,
          commandResults: result.commandResults,
          domain: redactEmail(result.domain as unknown as Record<string, unknown>) });
        return true;
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/live-check$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const d = ctx.email.get(id);
        const live = await runLiveEmailChecks({
          domain: d.domain,
          serverIp: d.server_ip,
          mailHostname: d.mail_hostname,
          dkimPublicKey: d.dkim_public_key,
          dkimSelector: d.dkim_selector });
        // Persist real probe results into domain health (not marketing scores)
        try {
          ctx.email.updateChecks(
            id,
            {
              dnsApplied: live.mx.ok && live.spf.ok && live.dkim.ok,
              dmarcPresent: live.dmarc.ok,
              ptrOk: live.ptr.ok,
              port25Open: live.port25.ok },
            user.username,
          );
        } catch {
          /* non-fatal */
        }
        sendJson(res, 200, {
          ...live,
          ok: live.health.score >= 60 && live.dnsbl.ok });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/policy$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          rateLimitPerHour?: number | null;
          antispam?: boolean;
          applySystem?: boolean;
        };
        const domain = ctx.email.get(id);
        await ctx.email.updateDomainMailFlags(
          id,
          {
            rateLimitPerHour: data.rateLimitPerHour,
            antispam: data.antispam },
          user.username,
        );
        const { applyMailDomainPolicy } = await import('@ysk/core');
        const r = await applyMailDomainPolicy({
          dataDir: ctx.dataDir,
          host: ctx.host,
          domain: domain.domain,
          rateLimitPerHour: data.rateLimitPerHour,
          antispam: data.antispam,
          applySystem: data.applySystem });
        ctx.audit.append({
          actor: user.username,
          action: 'email.domain.policy',
          resource: id,
          detail: r,
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }

      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/warmup$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const d = ctx.email.get(id);
        const plan = planEmailWarmup({
          domain: d.domain,
          serverIp: d.server_ip,
          isNewIp: true });
        sendJson(res, 200, plan);
        return true;
      }

      if (
        method === 'DELETE' &&
        url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/mailboxes\/[^/]+$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const parts = url.pathname.split('/');
        const domainId = parts[5] ?? '';
        const mailboxId = parts[7] ?? '';
        const result = await ctx.email.deleteMailbox(domainId, mailboxId, user.username);
        ctx.audit.append({
          actor: user.username,
          action: 'email.mailbox.delete',
          resource: result.address,
          detail: { domainId, mailboxId },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }

      if (
        method === 'DELETE' &&
        url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/aliases\/[^/]+$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const parts = url.pathname.split('/');
        const id = parts[5];
        const aliasId = parts[7];
        const result = ctx.email.deleteAlias(id, aliasId, user.username);
        sendJson(res, 200, result);
        return true;
      }

      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/dovecot-passdb$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const domain = ctx.email.get(id);
        const result = writeDovecotPassdb({
          dataDir: ctx.dataDir,
          db: ctx.db,
          domain: domain.domain,
          domainId: id });
        ctx.audit.append({
          actor: user.username,
          action: 'email.dovecot_passdb',
          resource: domain.domain,
          detail: { mailboxCount: result.mailboxCount, written: result.written },
          ok: result.ok });
        sendOpsResult(res, result);
        return true;
      }

  return false;
}
