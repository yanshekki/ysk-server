/**
 * Managed resource create/patch/delete (Wave U1).
 * Extracted from resources-crud.ts. Behaviour preserved.
 */
import { tl } from '@ysk/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listResources,
  getResource,
  createResource,
  updateResource,
  deleteResource,
  revokeManagedNginxSite,
  seedDnsZoneRecords,
  type CollectionKey,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { readBody, sendJson, sendOpsResult } from '../http/util.js';
import {
  normalizeFtpPasswordFields,
  redactResourceSecrets,
} from './resources-shared.js';

export async function handleResourcesWriteRoutes(
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
  // CREATE
  if (method === 'POST' && !id) {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    if (key === 'certificates') {
      sendJson(res, 400, {
        ok: false,
        message: tl('notes.auto.n1379') });
      return true;
    }
    // DNS zone: seed template records
    if (key === 'dns_zones') {
      const zone = String(data.zone ?? '').trim();
      const serverIp = String(data.serverIp ?? '127.0.0.1');
      const serverIpv6 = data.serverIpv6
        ? String(data.serverIpv6).trim()
        : undefined;
      const template = String(data.template ?? 'full');
      if (!zone) {
        sendJson(res, 400, { ok: false, message: tl('notes.auto.n1392') });
        return true;
      }
      const nsName = data.nsName ? String(data.nsName).trim() : undefined;
      const ttlRaw = data.ttl != null ? Number(data.ttl) : undefined;
      const ttl =
        ttlRaw != null && Number.isFinite(ttlRaw) && ttlRaw >= 0
          ? Math.floor(ttlRaw)
          : 300;
      const row = createResource(ctx.db, key, {
        zone,
        serverIp,
        ...(serverIpv6 ? { serverIpv6 } : {}),
        mailHost: data.mailHost,
        backend: data.backend ?? 'bind',
        template,
        ...(nsName ? { nsName } : {}),
        ttl,
        apply_status: 'draft' });
      seedDnsZoneRecords(
        ctx.db,
        String(row.id),
        zone,
        serverIp,
        template,
        serverIpv6,
      );
      ctx.audit.append({
        actor: user.username,
        action: 'resources.create',
        resource: prefix,
        detail: { id: row.id, zone, template },
        ok: true });
      sendJson(res, 201, { item: row });
      return true;
    }
    // MySQL DB: optional create linked user
    if (key === 'mysql_databases') {
      const name = String(data.name ?? '').trim();
      if (!name) {
        sendJson(res, 400, { ok: false, message: tl('notes.needName') });
        return true;
      }
      const eng = data.engine === 'mariadb' ? 'mariadb' : 'mysql';
      const row = createResource(ctx.db, key, {
        name,
        charset: data.charset ?? 'utf8mb4',
        projectId: data.projectId,
        engine: eng,
        apply_status: 'draft' });
      if (data.createUser && data.username && data.password) {
        createResource(ctx.db, 'mysql_users', {
          username: data.username,
          host: data.host ?? 'localhost',
          password_plain: data.password,
          databaseId: row.id,
          privileges: data.privileges ?? ['ALL'],
          engine: eng,
          apply_status: 'draft' });
      }
      ctx.audit.append({
        actor: user.username,
        action: 'resources.create',
        resource: prefix,
        detail: { id: row.id, name },
        ok: true });
      sendJson(res, 201, { item: row });
      return true;
    }
    if (key === 'postgres_databases') {
      const name = String(data.name ?? '').trim();
      if (!name) {
        sendJson(res, 400, { ok: false, message: tl('notes.needName') });
        return true;
      }
      const row = createResource(ctx.db, key, {
        name,
        projectId: data.projectId,
        apply_status: 'draft' });
      if (data.createUser && data.username && data.password) {
        createResource(ctx.db, 'postgres_users', {
          username: data.username,
          password_plain: data.password,
          databaseId: row.id,
          apply_status: 'draft' });
      }
      sendJson(res, 201, { item: row });
      return true;
    }

    const createData =
      key === 'ftp_accounts'
        ? normalizeFtpPasswordFields({ ...data, apply_status: data.apply_status ?? 'draft' })
        : { ...data, apply_status: data.apply_status ?? 'draft' };
    const row = createResource(ctx.db, key, createData);
    ctx.audit.append({
      actor: user.username,
      action: 'resources.create',
      resource: prefix,
      detail: { id: row.id },
      ok: true });
    sendJson(res, 201, {
      item: redactResourceSecrets(key, row as Record<string, unknown>),
    });
    return true;
  }

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
      const { deleteCertificate } = await import('@ysk/core');
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
          const { removeManagedDnsZoneFiles, syncPowerDnsBindZones } = await import('@ysk/core');
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
