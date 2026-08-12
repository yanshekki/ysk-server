import { tl } from '@yanshekki/shared';
/**
 * Minimal WebDAV settings + PROPFIND XML helpers (managed under panel).
 * Real PROPFIND/PUT handlers live in server controller; this is control-plane config.
 */

import type { JsonStore } from '../db/store.js';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/** Fixed Basic username for WebDAV (password = issued token). */
export const WEBDAV_USERNAME = 'ysk';

export type WebDavSettings = {
  enabled: boolean;
  /** path prefix e.g. /webdav */
  mountPath: string;
  /** bcrypt-less token hash for Basic password (token is the password; user=ysk) */
  tokenHash?: string;
  /** last issued token id (not the secret) */
  tokenId?: string;
  updated_at?: string;
};

const KEY = 'webdav_settings';

export function getWebDavSettings(db: JsonStore): WebDavSettings {
  const raw = db.snapshot.settings?.[KEY];
  if (!raw) {
    return { enabled: false, mountPath: '/webdav' };
  }
  try {
    return { enabled: false, mountPath: '/webdav', ...JSON.parse(raw) } as WebDavSettings;
  } catch {
    return { enabled: false, mountPath: '/webdav' };
  }
}

export function setWebDavSettings(
  db: JsonStore,
  patch: Partial<WebDavSettings>,
): WebDavSettings {
  const next = { ...getWebDavSettings(db), ...patch, updated_at: new Date().toISOString() };
  db.snapshot.settings[KEY] = JSON.stringify(next);
  db.persist();
  return { ...next };
}

/** Issue new access token; returns plaintext once. */
export function issueWebDavToken(db: JsonStore): {
  settings: WebDavSettings;
  token: string;
  notes: string[];
} {
  const token = randomBytes(24).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const tokenId = randomBytes(4).toString('hex');
  const settings = setWebDavSettings(db, {
    enabled: true,
    tokenHash,
    tokenId,
  });
  return {
    settings,
    token,
    notes: [
      tl('notes.auto.n0748'),
      tl('notes.auto.n0471'),
    ],
  };
}

export function verifyWebDavToken(db: JsonStore, password: string): boolean {
  const s = getWebDavSettings(db);
  if (!s.enabled || !s.tokenHash || !password) return false;
  const h = createHash('sha256').update(password).digest('hex');
  try {
    const a = Buffer.from(h, 'utf8');
    const b = Buffer.from(String(s.tokenHash), 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Parse HTTP Basic credentials. Username must be WEBDAV_USERNAME.
 * Returns false if header missing/malformed or user/password wrong.
 */
export function verifyWebDavBasicAuth(
  db: JsonStore,
  authorizationHeader: string | undefined,
): boolean {
  const auth = authorizationHeader ?? '';
  if (!auth.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 0) return false;
    const user = decoded.slice(0, colon);
    const pass = decoded.slice(colon + 1);
    if (user !== WEBDAV_USERNAME) return false;
    return verifyWebDavToken(db, pass);
  } catch {
    return false;
  }
}

export function buildPropfindResponse(input: {
  href: string;
  entries: Array<{ name: string; href: string; isDir: boolean; size: number; mtime: string }>;
}): string {
  const rows = input.entries
    .map(
      (e) => `
  <D:response>
    <D:href>${escapeXml(e.href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(e.name)}</D:displayname>
        <D:getcontentlength>${e.isDir ? 0 : e.size}</D:getcontentlength>
        <D:getlastmodified>${escapeXml(e.mtime)}</D:getlastmodified>
        <D:resourcetype>${e.isDir ? '<D:collection/>' : ''}</D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${escapeXml(input.href)}</D:href>
    <D:propstat>
      <D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>${rows}
</D:multistatus>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
