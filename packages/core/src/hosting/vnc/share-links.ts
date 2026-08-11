/**
 * Short-lived share links for read-only (or full) browser VNC access
 * without giving panel credentials.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VncSessionKind } from './session-ticket.js';

export type VncShareRecord = {
  token: string;
  kind: VncSessionKind;
  targetId: string;
  label: string;
  viewOnly: boolean;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
};

function storePath(dataDir: string): string {
  return join(dataDir, 'vnc', 'share-links.json');
}

function loadAll(dataDir: string): VncShareRecord[] {
  const p = storePath(dataDir);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { items?: VncShareRecord[] };
    const now = Date.now();
    return (Array.isArray(raw.items) ? raw.items : []).filter((x) => x.expiresAt > now);
  } catch {
    return [];
  }
}

function saveAll(dataDir: string, items: VncShareRecord[]): void {
  mkdirSync(join(dataDir, 'vnc'), { recursive: true });
  writeFileSync(
    storePath(dataDir),
    JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
}

const DEFAULT_TTL_MS = 60 * 60_000;
const MAX_TTL_MS = 24 * 60 * 60_000;

export function createVncShareLink(input: {
  dataDir: string;
  kind: VncSessionKind;
  targetId: string;
  label: string;
  createdBy: string;
  viewOnly?: boolean;
  ttlMs?: number;
}): VncShareRecord {
  const ttl = Math.min(
    Math.max(input.ttlMs ?? DEFAULT_TTL_MS, 5 * 60_000),
    MAX_TTL_MS,
  );
  const now = Date.now();
  const rec: VncShareRecord = {
    token: randomBytes(24).toString('base64url'),
    kind: input.kind,
    targetId: input.targetId,
    label: input.label,
    viewOnly: input.viewOnly !== false,
    createdBy: input.createdBy,
    createdAt: now,
    expiresAt: now + ttl,
  };
  const items = loadAll(input.dataDir).filter(
    (x) => !(x.kind === rec.kind && x.targetId === rec.targetId && x.createdBy === rec.createdBy),
  );
  items.push(rec);
  // Cap store size
  while (items.length > 100) items.shift();
  saveAll(input.dataDir, items);
  return rec;
}

export function getVncShareLink(
  dataDir: string,
  token: string,
): VncShareRecord | null {
  const t = String(token || '').trim();
  if (!t) return null;
  const rec = loadAll(dataDir).find((x) => x.token === t);
  if (!rec || rec.expiresAt <= Date.now()) return null;
  return rec;
}

export function revokeVncShareLink(dataDir: string, token: string): boolean {
  const items = loadAll(dataDir);
  const next = items.filter((x) => x.token !== token);
  if (next.length === items.length) return false;
  saveAll(dataDir, next);
  return true;
}
