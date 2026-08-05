import { tl } from '@ysk/shared';
/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  uploadCertificate,
  listUploadedCertFiles,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import {
  getBearer,
  readBody,
  sendJson,
} from '../http/util.js';

export async function handleSslRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'POST' && url.pathname === '/api/v1/ssl/upload') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          fullchainPem?: string;
          privkeyPem?: string;
        };
        const cert = uploadCertificate({
          db: ctx.db,
          dataDir: ctx.dataDir,
          domain: data.domain ?? '',
          fullchainPem: data.fullchainPem ?? '',
          privkeyPem: data.privkeyPem ?? '',
          actor: user.username,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'ssl.upload',
          resource: cert.domain,
          detail: { id: cert.id, paths: [cert.fullchain_path, cert.privkey_path] },
          ok: true,
        });
        sendJson(res, 201, { certificate: cert });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/ssl/uploaded') {
        ctx.auth.authenticate(getBearer(req));
        const { listCertificatesView, dedupeCertificatesInStore } = await import('@ysk/core');
        dedupeCertificatesInStore(ctx.db);
        sendJson(res, 200, {
          files: listUploadedCertFiles(ctx.dataDir),
          certificates: listCertificatesView(ctx.db, ctx.dataDir),
          items: listCertificatesView(ctx.db, ctx.dataDir),
        });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/ssl/certificates') {
        ctx.auth.authenticate(getBearer(req));
        const { listCertificatesView, dedupeCertificatesInStore } = await import('@ysk/core');
        dedupeCertificatesInStore(ctx.db);
        type Cert = { domain?: string; id?: string; issuer?: string; status?: string };
        const all = listCertificatesView(ctx.db, ctx.dataDir) as unknown as Cert[];
        const { items, meta } = listWithQuery(url, all, {
          text: (c: Cert) => [
            String(c.domain ?? ''),
            String(c.id ?? ''),
            String(c.issuer ?? ''),
            String(c.status ?? ''),
          ],
        });
        sendJson(res, 200, { items, meta });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/ssl/bindings') {
        ctx.auth.authenticate(getBearer(req));
        const { listCertificatesView, dedupeCertificatesInStore } = await import('@ysk/core');
        dedupeCertificatesInStore(ctx.db);
        const certs = listCertificatesView(ctx.db, ctx.dataDir);
        const projects = ctx.projects.list();
        const mail = ctx.email.list();
        const bindings = certs.map((c) => {
          const domain = String((c as { domain?: string }).domain ?? '');
          const linkedProjects = projects
            .filter(
              (p) =>
                p.domain === domain ||
                (p.domainAliases ?? []).includes(domain) ||
                (domain && p.domain?.endsWith(domain)),
            )
            .map((p) => ({ id: p.id, name: p.name, domain: p.domain }));
          const linkedMail = mail
            .filter((m) => m.domain === domain || domain.endsWith(m.domain))
            .map((m) => ({ id: m.id, domain: m.domain }));
          return {
            ...c,
            projects: linkedProjects,
            mailDomains: linkedMail,
          };
        });
        // renew job probe — systemd timer + panel cron
        const cronJobs = ctx.cron.list().filter(
          (j) =>
            j.command.includes('certbot') ||
            j.command.includes('letsencrypt') ||
            j.command.includes('ssl'),
        );
        const { probeSslAutoRenewal } = await import('@ysk/core');
        const renewal = await probeSslAutoRenewal({
          host: ctx.host,
          cronJobs,
        });
        sendJson(res, 200, {
          items: bindings,
          renewJobs: cronJobs,
          renewal,
          notes: renewal.notes.length
            ? renewal.notes
            : [
                cronJobs.length
                  ? tl('notes.auto.t0789', { v0: cronJobs.length })
                  : tl('notes.auto.n0962'),
              ],
        });
        return true;
      }
  return false;
}
