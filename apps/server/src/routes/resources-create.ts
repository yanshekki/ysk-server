/**
 * Managed resource create (Wave Z3).
 * Extracted from resources-write.ts. Behaviour preserved.
 */
import { tl } from '@ysk-server/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createResource,
  seedDnsZoneRecords,
  type CollectionKey,
} from '@ysk-server/core';
import type { AppContext } from '../app-context.js';
import { readBody, sendJson } from '../http/util.js';
import {
  normalizeFtpPasswordFields,
  redactResourceSecrets,
} from './resources-shared.js';

export async function handleResourcesCreateRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  method: string,
  user: { username: string },
  key: CollectionKey,
  id: string | null,
  _action: string | null,
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

  return false;
}
