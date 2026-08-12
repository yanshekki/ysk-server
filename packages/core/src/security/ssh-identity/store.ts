import { tl } from '@yanshekki/shared';
/**
 * SSH identity vault store under dataDir/secrets/ssh/identities.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { JsonStore } from '../../db/store.js';
import {
  decryptPrivateKey,
  encryptPrivateKey,
  resolveMasterKey,
  secretsSshDir } from './crypto.js';
import { generateSshKeyPair, parseImportedPrivateKey } from './generate.js';
import type {
  SshIdentity,
  SshIdentityAlgorithm,
  SshIdentityBinding,
  SshIdentityPublic,
  SshIdentityPurpose } from './types.js';
import { toPublicIdentity } from './types.js';

function identitiesPath(dataDir: string): string {
  return join(secretsSshDir(dataDir), 'identities.json');
}

function loadAll(dataDir: string): SshIdentity[] {
  const path = identitiesPath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { items?: SshIdentity[] };
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

function saveAll(dataDir: string, items: SshIdentity[]): void {
  const dir = secretsSshDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const path = identitiesPath(dataDir);
  writeFileSync(path, JSON.stringify({ items }, null, 2), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

export type ListSshIdentitiesFilter = {
  projectId?: string;
  linuxUser?: string;
  purpose?: SshIdentityPurpose;
};

export function listSshIdentities(
  dataDir: string,
  filter?: ListSshIdentitiesFilter,
): SshIdentityPublic[] {
  let items = loadAll(dataDir);
  if (filter?.projectId) {
    items = items.filter((i) => i.binding?.projectId === filter.projectId);
  }
  if (filter?.linuxUser) {
    items = items.filter((i) => i.binding?.linuxUser === filter.linuxUser);
  }
  if (filter?.purpose) {
    items = items.filter((i) => i.purpose === filter.purpose);
  }
  return items.map(toPublicIdentity);
}

export function getSshIdentity(dataDir: string, id: string): SshIdentityPublic | null {
  const row = loadAll(dataDir).find((i) => i.id === id);
  return row ? toPublicIdentity(row) : null;
}

export function getSshIdentityInternal(dataDir: string, id: string): SshIdentity | null {
  return loadAll(dataDir).find((i) => i.id === id) ?? null;
}

function resolveBinding(
  db: JsonStore | undefined,
  binding?: SshIdentityBinding,
): SshIdentityBinding | undefined {
  if (!binding) return undefined;
  let projectId = binding.projectId?.trim() || undefined;
  let linuxUser = binding.linuxUser?.trim() || undefined;
  let homeDir = binding.homeDir?.trim() || undefined;
  if (projectId && db) {
    const p = db.snapshot.projects.find((x) => x.id === projectId);
    if (p) {
      linuxUser = linuxUser || p.linux_user;
      homeDir = homeDir || p.home_dir;
    }
  }
  return { projectId, linuxUser, homeDir };
}

export type CreateSshIdentityInput = {
  name: string;
  comment?: string;
  algorithm?: SshIdentityAlgorithm;
  purpose?: SshIdentityPurpose;
  binding?: SshIdentityBinding;
  createdBy?: string;
  /** If true, include plaintext privateKey once in result */
  revealPrivate?: boolean;
};

export type CreateSshIdentityResult = {
  ok: boolean;
  identity?: SshIdentityPublic;
  /** One-time only when revealPrivate */
  privateKey?: string;
  masterKeySource?: string;
  notes: string[];
};

export function createSshIdentity(
  dataDir: string,
  input: CreateSshIdentityInput,
  db?: JsonStore,
): CreateSshIdentityResult {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, notes: [tl('notes.auto.n0029')] };
  }
  const notes: string[] = [];
  let master;
  try {
    master = resolveMasterKey(dataDir);
  } catch (e) {
    return {
      ok: false,
      notes: [e instanceof Error ? e.message : 'master key unavailable'] };
  }
  if (master.source === 'generated') {
    notes.push(tl('notes.auto.t0520', { v0: (master.path ?? 'secrets/ssh/.master.key') }));
  } else if (master.source === 'env') {
    notes.push(tl('notes.auto.n0538'));
  }

  const pair = generateSshKeyPair({
    algorithm: input.algorithm,
    comment: input.comment ?? name });
  const id = randomUUID();
  const now = new Date().toISOString();
  const purpose = input.purpose ?? 'unbound';
  const binding = resolveBinding(db, input.binding);

  const row: SshIdentity = {
    id,
    name,
    comment: input.comment,
    algorithm: pair.algorithm,
    fingerprintSha256: pair.fingerprintSha256,
    publicKey: pair.publicKey,
    privateKeyEnc: encryptPrivateKey(master.key, id, pair.privateKey),
    purpose,
    binding,
    status: 'stored',
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy };

  const items = loadAll(dataDir);
  items.unshift(row);
  saveAll(dataDir, items);

  return {
    ok: true,
    identity: toPublicIdentity(row),
    privateKey: input.revealPrivate ? pair.privateKey : undefined,
    masterKeySource: master.source,
    notes };
}

export type ImportSshIdentityInput = {
  name: string;
  privateKey: string;
  comment?: string;
  purpose?: SshIdentityPurpose;
  binding?: SshIdentityBinding;
  createdBy?: string;
  revealPrivate?: boolean;
};

export function importSshIdentity(
  dataDir: string,
  input: ImportSshIdentityInput,
  db?: JsonStore,
): CreateSshIdentityResult {
  const name = input.name.trim();
  if (!name) return { ok: false, notes: [tl('notes.auto.n0029')] };
  if (!input.privateKey?.trim()) return { ok: false, notes: [tl('notes.auto.n1568')] };

  const notes: string[] = [];
  let master;
  try {
    master = resolveMasterKey(dataDir);
  } catch (e) {
    return {
      ok: false,
      notes: [e instanceof Error ? e.message : 'master key unavailable'] };
  }
  if (master.source === 'generated') {
    notes.push(tl('notes.auto.t0521', { v0: (master.path ?? 'secrets/ssh/.master.key') }));
  }

  let pair;
  try {
    pair = parseImportedPrivateKey(input.privateKey);
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : 'import failed'] };
  }

  // Dedup by fingerprint
  const existing = loadAll(dataDir).find((i) => i.fingerprintSha256 === pair.fingerprintSha256);
  if (existing) {
    return {
      ok: false,
      notes: [tl('notes.auto.t0522', { v0: (existing.id), v1: (existing.name) })],
      identity: toPublicIdentity(existing) };
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const row: SshIdentity = {
    id,
    name,
    comment: input.comment,
    algorithm: pair.algorithm,
    fingerprintSha256: pair.fingerprintSha256,
    publicKey: pair.publicKey,
    privateKeyEnc: encryptPrivateKey(master.key, id, pair.privateKey),
    purpose: input.purpose ?? 'unbound',
    binding: resolveBinding(db, input.binding),
    status: 'stored',
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy };

  const items = loadAll(dataDir);
  items.unshift(row);
  saveAll(dataDir, items);

  return {
    ok: true,
    identity: toPublicIdentity(row),
    privateKey: input.revealPrivate ? pair.privateKey : undefined,
    masterKeySource: master.source,
    notes };
}

export function exportSshIdentityPrivate(
  dataDir: string,
  id: string,
): { ok: boolean; privateKey?: string; fingerprintSha256?: string; notes: string[] } {
  const row = getSshIdentityInternal(dataDir, id);
  if (!row) return { ok: false, notes: [tl('notes.ssh.identityNotFound')] };
  try {
    const master = resolveMasterKey(dataDir);
    const privateKey = decryptPrivateKey(master.key, row.id, row.privateKeyEnc);
    return {
      ok: true,
      privateKey,
      fingerprintSha256: row.fingerprintSha256,
      notes: ['private key exported — treat as secret; audit recommended'] };
  } catch (e) {
    return {
      ok: false,
      notes: [e instanceof Error ? e.message : 'decrypt failed'] };
  }
}

export function deleteSshIdentity(
  dataDir: string,
  id: string,
): { ok: boolean; notes: string[] } {
  const items = loadAll(dataDir);
  const next = items.filter((i) => i.id !== id);
  if (next.length === items.length) {
    return { ok: false, notes: [tl('notes.ssh.identityNotFound')] };
  }
  saveAll(dataDir, next);
  return {
    ok: true,
    notes: [tl('notes.auto.n0775')] };
}

export function updateSshIdentityRecord(
  dataDir: string,
  id: string,
  patch: Partial<
    Pick<SshIdentity, 'name' | 'comment' | 'purpose' | 'binding' | 'install' | 'status' | 'lastVerifiedAt' | 'lastVerifyNote'>
  >,
): SshIdentityPublic | null {
  const items = loadAll(dataDir);
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const prev = items[idx]!;
  items[idx] = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString() };
  saveAll(dataDir, items);
  return toPublicIdentity(items[idx]!);
}
