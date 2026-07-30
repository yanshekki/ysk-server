/**
 * Remember-device tokens — skip TOTP for limited days after successful 2FA.
 * Token: yskdev_<base64url(payload)>.<hmac>
 * Payload: userId|deviceId|exp
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { JsonStore } from '../../db/store.js';
import { resolveMasterKey } from '../ssh-identity/crypto.js';

const DEFAULT_DAYS = 30;

function hmacKey(dataDir: string): Buffer {
  try {
    return resolveMasterKey(dataDir).key;
  } catch {
    return createHash('sha256').update('ysk-dev-fallback').digest();
  }
}

export function createRememberDeviceToken(input: {
  dataDir: string;
  db: JsonStore;
  userId: string;
  userAgent?: string;
  ip?: string;
  days?: number;
}): { token: string; deviceId: string; expiresAt: string } {
  const deviceId = randomBytes(12).toString('hex');
  const days = input.days ?? DEFAULT_DAYS;
  const exp = Date.now() + days * 24 * 60 * 60 * 1000;
  const payload = `${input.userId}|${deviceId}|${exp}`;
  const sig = createHmac('sha256', hmacKey(input.dataDir))
    .update(payload)
    .digest('base64url');
  const token = `yskdev_${Buffer.from(payload).toString('base64url')}.${sig}`;
  const hashes = loadDeviceHashes(input.db, input.userId);
  hashes.push({
    id: deviceId,
    hash: createHash('sha256').update(token).digest('hex'),
    exp,
    ua: (input.userAgent ?? '').slice(0, 120),
    ip: input.ip,
    created_at: new Date().toISOString(),
  });
  // keep last 10
  while (hashes.length > 10) hashes.shift();
  saveDeviceHashes(input.db, input.userId, hashes);
  return {
    token,
    deviceId,
    expiresAt: new Date(exp).toISOString(),
  };
}

export function verifyRememberDeviceToken(input: {
  dataDir: string;
  db: JsonStore;
  userId: string;
  token: string;
}): boolean {
  if (!input.token.startsWith('yskdev_')) return false;
  const body = input.token.slice('yskdev_'.length);
  const [pB64, sig] = body.split('.');
  if (!pB64 || !sig) return false;
  let payload: string;
  try {
    payload = Buffer.from(pB64, 'base64url').toString('utf8');
  } catch {
    return false;
  }
  const expected = createHmac('sha256', hmacKey(input.dataDir))
    .update(payload)
    .digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  const [uid, deviceId, expStr] = payload.split('|');
  if (uid !== input.userId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const hashes = loadDeviceHashes(input.db, input.userId);
  const h = createHash('sha256').update(input.token).digest('hex');
  return hashes.some((d) => d.id === deviceId && d.hash === h && d.exp >= Date.now());
}

export function listRememberDevices(db: JsonStore, userId: string) {
  return loadDeviceHashes(db, userId).map((d) => ({
    id: d.id,
    created_at: d.created_at,
    expires_at: new Date(d.exp).toISOString(),
    user_agent: d.ua,
    ip: d.ip,
  }));
}

export function revokeRememberDevice(
  db: JsonStore,
  userId: string,
  deviceId: string,
): boolean {
  const hashes = loadDeviceHashes(db, userId);
  const next = hashes.filter((d) => d.id !== deviceId);
  saveDeviceHashes(db, userId, next);
  return next.length < hashes.length;
}

export function revokeAllRememberDevices(db: JsonStore, userId: string): number {
  const n = loadDeviceHashes(db, userId).length;
  saveDeviceHashes(db, userId, []);
  return n;
}

type DevRow = {
  id: string;
  hash: string;
  exp: number;
  ua?: string;
  ip?: string;
  created_at: string;
};

function loadDeviceHashes(db: JsonStore, userId: string): DevRow[] {
  const raw = db.snapshot.settings[`devices.${userId}`];
  if (!raw) return [];
  try {
    return JSON.parse(raw) as DevRow[];
  } catch {
    return [];
  }
}

function saveDeviceHashes(db: JsonStore, userId: string, rows: DevRow[]): void {
  db.snapshot.settings[`devices.${userId}`] = JSON.stringify(rows);
  db.persist();
}
