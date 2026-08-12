/**
 * Managed resource patch/delete (Wave Z3).
 * Extracted from resources-write.ts. Behaviour preserved.
 */
import { tl } from '@yanshekki/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listResources,
  getResource,
  updateResource,
  deleteResource,
  revokeManagedNginxSite,
  type CollectionKey,
} from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import { readBody, sendJson, sendOpsResult } from '../http/util.js';
import {
  normalizeFtpPasswordFields,
  redactResourceSecrets,
} from './resources-shared.js';

export async function handleResourcesMutateRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  method: string,
  user: { username: string },
  key: CollectionKey,
  id: string | null,
  action: string | null,
  prefix: string,
): Promise<boolean> {
  // PATCH
  if (method === 'PATCH' && id && !action) {
    const raw = await readBody(req);
    let data = JSON.parse(raw || '{}') as Record<string, unknown>;
    delete data.id;
    if (key === 'ftp_accounts') {
      data = normalizeFtpPasswordFields(data);
    }
    const row = updateResource(ctx.db, key, id, data);
    if (!row) {
      sendJson(res, 404, { ok: false, message: tl('notes.auto.n0004') });
      return true;
    }
    ctx.audit.append({
      actor: user.username,
      action: 'resources.update',
      resource: `${prefix}/${id}`,
      detail: { ...data, password_plain: undefined, password: undefined, password_hash: data.password_hash ? '[set]' : undefined },
      ok: true });
    sendJson(res, 200, {
      item: redactResourceSecrets(key, row as Record<string, unknown>),
    });
    return true;
  }

  // DELETE
  if (method === 'DELETE' && id && !action) {
    if (key === 'nginx_sites') {
      const r = revokeManagedNginxSite(ctx.db, id);
      ctx.audit.append({
        actor: user.username,
        action: 'resources.delete',
        resource: `${prefix}/${id}`,
        detail: r,
        ok: r.ok });
      sendOpsResult(res, r, { notFound: true });
      return true;
    }
    if (key === 'certificates') {
      const { deleteCertificate } = await import('@yanshekki/core');
      const r = deleteCertificate(ctx.db, ctx.dataDir, id);
      sendOpsResult(res, r, { notFound: true });
      return true;
    }
    if (key === 'dns_zones') {
      const zoneRow = getResource(ctx.db, 'dns_zones', id);
      const zoneName = zoneRow ? String(zoneRow.zone ?? '') : '';
      // cascade records
      for (const rec of listResources(ctx.db, 'dns_records').filter((r) => r.zoneId === id)) {
        deleteResource(ctx.db, 'dns_records', String(rec.id));
      }
      // Drop managed zone files + re-sync PowerDNS named.conf (avoid answering deleted zones)
      if (zoneName) {
        try {
          const { removeManagedDnsZoneFiles, syncPowerDnsBindZones } = await import('@yanshekki/core');
          const rm = removeManagedDnsZoneFiles(ctx.dataDir, zoneName);
          ctx.audit.append({
            actor: user.username,
            action: 'dns.zone_file.remove',
            resource: zoneName,
            detail: rm,
            ok: rm.ok,
          });
          if (ctx.host.executeEnabled() && ctx.host.isRoot()) {
            const sync = await syncPowerDnsBindZones({
              dataDir: ctx.dataDir,
              host: ctx.host,
              apply: true,
            });
            ctx.audit.append({
              actor: user.username,
              action: 'dns.powerdns.unbind',
              resource: zoneName,
              detail: { ok: sync.ok, mode: sync.mode, zones: sync.zones },
              ok: sync.ok,
            });
          }
        } catch {
          /* best-effort cleanup */
        }
      }
    }
    if (key === 'mysql_databases') {
      for (const u of listResources(ctx.db, 'mysql_users').filter((r) => r.databaseId === id)) {
        deleteResource(ctx.db, 'mysql_users', String(u.id));
      }
    }
    if (key === 'postgres_databases') {
      for (const u of listResources(ctx.db, 'postgres_users').filter((r) => r.databaseId === id)) {
        deleteResource(ctx.db, 'postgres_users', String(u.id));
      }
    }
    const ok = deleteResource(ctx.db, key, id);
    ctx.audit.append({
      actor: user.username,
      action: 'resources.delete',
      resource: `${prefix}/${id}`,
      detail: { ok },
      ok });
    sendJson(res, ok ? 200 : 404, { ok });
    return true;
  }

  return false;
}
