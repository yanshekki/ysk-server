/**
 * Managed resource CRUD routes — nginx, ftp, mysql, postgres, redis, dns, certificates.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listResources,
  getResource,
  createResource,
  updateResource,
  deleteResource,
  applyManagedNginxSite,
  revokeManagedNginxSite,
  applyMysqlDatabase,
  applyPostgresDatabase,
  applyRedisInstance,
  applyDnsZone,
  seedDnsZoneRecords,
  type CollectionKey,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';

const COLLECTIONS: Record<string, CollectionKey> = {
  'nginx/sites': 'nginx_sites',
  'ftp/accounts': 'ftp_accounts',
  'mysql/databases': 'mysql_databases',
  'mysql/users': 'mysql_users',
  'postgres/databases': 'postgres_databases',
  'postgres/users': 'postgres_users',
  'redis/instances': 'redis_instances',
  'dns/zones': 'dns_zones',
  'dns/records': 'dns_records',
  'ssl/certs': 'certificates',
};

function parseCollection(pathname: string): {
  key: CollectionKey | null;
  id: string | null;
  action: string | null;
  prefix: string | null;
} {
  // /api/v1/resources/<prefix...> or /api/v1/resources/<prefix...>/:id(/action)
  if (!pathname.startsWith('/api/v1/resources/')) {
    return { key: null, id: null, action: null, prefix: null };
  }
  const rest = pathname.slice('/api/v1/resources/'.length);
  const parts = rest.split('/').filter(Boolean);
  // try longest prefix match
  for (let len = Math.min(parts.length, 2); len >= 1; len--) {
    const prefix = parts.slice(0, len).join('/');
    if (COLLECTIONS[prefix]) {
      const id = parts[len] ?? null;
      const action = parts[len + 1] ?? null;
      return { key: COLLECTIONS[prefix], id, action, prefix };
    }
  }
  return { key: null, id: null, action: null, prefix: null };
}

export async function handleResourcesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/resources')) return false;

  const user = ctx.auth.authenticate(getBearer(req));
  const { key, id, action, prefix } = parseCollection(url.pathname);
  if (!key || !prefix) {
    sendJson(res, 404, { ok: false, message: '未知的資源類型' });
    return true;
  }

  // LIST
  if (method === 'GET' && !id) {
    // SSL: never expose raw multi-row junk — use disk+store view
    if (key === 'certificates') {
      const { listCertificatesView, dedupeCertificatesInStore } = await import('@ysk/core');
      dedupeCertificatesInStore(ctx.db);
      sendJson(res, 200, { items: listCertificatesView(ctx.db, ctx.dataDir) });
      return true;
    }
    let items = listResources(ctx.db, key);
    const zoneId = url.searchParams.get('zoneId');
    const databaseId = url.searchParams.get('databaseId');
    const engine = url.searchParams.get('engine');
    if (zoneId) items = items.filter((r) => r.zoneId === zoneId);
    if (databaseId) items = items.filter((r) => r.databaseId === databaseId);
    if (engine) {
      items = items.filter((r) => String(r.engine ?? 'mysql') === engine);
    }
    sendJson(res, 200, { items });
    return true;
  }

  // GET one
  if (method === 'GET' && id && !action) {
    const row = getResource(ctx.db, key, id);
    if (!row) {
      sendJson(res, 404, { ok: false, message: '找不到資源' });
      return true;
    }
    sendJson(res, 200, { item: row });
    return true;
  }

  // CREATE
  if (method === 'POST' && !id) {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    if (key === 'certificates') {
      sendJson(res, 400, {
        ok: false,
        message: '請使用 POST /api/v1/ssl/upload 或 POST /api/v1/ssl/letsencrypt',
      });
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
        sendJson(res, 400, { ok: false, message: '請填寫 zone 名稱' });
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
        apply_status: 'draft',
      });
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
        ok: true,
      });
      sendJson(res, 201, { item: row });
      return true;
    }
    // MySQL DB: optional create linked user
    if (key === 'mysql_databases') {
      const name = String(data.name ?? '').trim();
      if (!name) {
        sendJson(res, 400, { ok: false, message: '請填寫名稱' });
        return true;
      }
      const eng = data.engine === 'mariadb' ? 'mariadb' : 'mysql';
      const row = createResource(ctx.db, key, {
        name,
        charset: data.charset ?? 'utf8mb4',
        projectId: data.projectId,
        engine: eng,
        apply_status: 'draft',
      });
      if (data.createUser && data.username && data.password) {
        createResource(ctx.db, 'mysql_users', {
          username: data.username,
          host: data.host ?? 'localhost',
          password_plain: data.password,
          databaseId: row.id,
          privileges: data.privileges ?? ['ALL'],
          engine: eng,
          apply_status: 'draft',
        });
      }
      ctx.audit.append({
        actor: user.username,
        action: 'resources.create',
        resource: prefix,
        detail: { id: row.id, name },
        ok: true,
      });
      sendJson(res, 201, { item: row });
      return true;
    }
    if (key === 'postgres_databases') {
      const name = String(data.name ?? '').trim();
      if (!name) {
        sendJson(res, 400, { ok: false, message: '請填寫名稱' });
        return true;
      }
      const row = createResource(ctx.db, key, {
        name,
        projectId: data.projectId,
        apply_status: 'draft',
      });
      if (data.createUser && data.username && data.password) {
        createResource(ctx.db, 'postgres_users', {
          username: data.username,
          password_plain: data.password,
          databaseId: row.id,
          apply_status: 'draft',
        });
      }
      sendJson(res, 201, { item: row });
      return true;
    }

    const row = createResource(ctx.db, key, { ...data, apply_status: data.apply_status ?? 'draft' });
    ctx.audit.append({
      actor: user.username,
      action: 'resources.create',
      resource: prefix,
      detail: { id: row.id },
      ok: true,
    });
    sendJson(res, 201, { item: row });
    return true;
  }

  // PATCH
  if (method === 'PATCH' && id && !action) {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    delete data.id;
    const row = updateResource(ctx.db, key, id, data);
    if (!row) {
      sendJson(res, 404, { ok: false, message: '找不到資源' });
      return true;
    }
    ctx.audit.append({
      actor: user.username,
      action: 'resources.update',
      resource: `${prefix}/${id}`,
      detail: data,
      ok: true,
    });
    sendJson(res, 200, { item: row });
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
        ok: r.ok,
      });
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
      // cascade records
      for (const rec of listResources(ctx.db, 'dns_records').filter((r) => r.zoneId === id)) {
        deleteResource(ctx.db, 'dns_records', String(rec.id));
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
      ok,
    });
    sendJson(res, ok ? 200 : 404, { ok });
    return true;
  }

  // APPLY
  if (method === 'POST' && id && action === 'apply') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { execute?: boolean };
    // Panel always executes unless explicitly dry-run
    const execute = data.execute !== false;

    if (key === 'nginx_sites') {
      const r = await applyManagedNginxSite(ctx.db, ctx.dataDir, id, {
        host: ctx.host,
        execute,
        systemConfDir: '/etc/nginx/conf.d',
      });
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'mysql_databases') {
      const r = await applyMysqlDatabase(ctx.db, id, ctx.host, execute);
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'postgres_databases') {
      const r = await applyPostgresDatabase(ctx.db, id, ctx.host, execute);
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'redis_instances') {
      const r = await applyRedisInstance(ctx.db, id, ctx.host, execute);
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'dns_zones') {
      const r = await applyDnsZone(ctx.db, ctx.dataDir, id, {
        host: ctx.host,
        validate: true,
        tryReload: execute,
      });
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'ftp_accounts') {
      const { applyFtpAccountReal } = await import('@ysk/core');
      const r = await applyFtpAccountReal({
        db: ctx.db,
        dataDir: ctx.dataDir,
        host: ctx.host,
        id,
      });
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'certificates') {
      sendJson(res, 410, {
        ok: false,
        notes: ['Use POST /api/v1/ssl/upload or /api/v1/ssl/letsencrypt — marking applied is disabled'],
      });
      return true;
    }

    sendJson(res, 400, { ok: false, message: '此資源不支援套用到系統' });
    return true;
  }

  return false;
}
