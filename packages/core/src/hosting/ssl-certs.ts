/**
 * Real SSL certificate management: disk files under dataDir/certs + single registry row per domain.
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  statSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID, X509Certificate } from 'node:crypto';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { YskDatabase } from '../db/database.js';

export interface StoredCertificate {
  id: string;
  domain: string;
  provider: 'upload' | 'letsencrypt';
  fullchain_path: string;
  privkey_path: string;
  apply_status: string;
  ok: boolean;
  notes: string[];
  created_at: string;
  updated_at: string;
  actor?: string;
  email?: string;
  commands?: string[];
  expires_at?: string;
}

/** List row merged from store + disk truth */
export interface CertificateView {
  id: string;
  domain: string;
  provider: 'upload' | 'letsencrypt' | 'unknown';
  /** Human status: uploaded | planned | issued | failed | missing */
  status: string;
  files_exist: boolean;
  fullchain_path?: string;
  privkey_path?: string;
  expires_at?: string | null;
  bytes?: number;
  notes: string[];
  updated_at?: string;
  created_at?: string;
}

const PEM_CERT = /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/;
const PEM_KEY =
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+-----END (RSA |EC |OPENSSH )?PRIVATE KEY-----/;

export function validatePemBundle(fullchain: string, privkey: string): void {
  if (!PEM_CERT.test(fullchain)) {
    throw new YskError(ErrorCodes.VALIDATION, 'fullchain must be PEM certificate(s)', {
      httpStatus: 400,
    });
  }
  if (!PEM_KEY.test(privkey)) {
    throw new YskError(ErrorCodes.VALIDATION, 'privkey must be PEM private key', {
      httpStatus: 400,
    });
  }
}

export function normalizeDomain(domain: string): string {
  const d = domain.trim().toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(d) || d.length < 3 || d.includes('..')) {
    throw new YskError(ErrorCodes.VALIDATION, 'Invalid domain', { httpStatus: 400 });
  }
  return d;
}

/** Parse leaf cert expiry; returns ISO or null if unreadable */
export function parseCertExpiryFromPem(pem: string): string | null {
  try {
    const block = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
    if (!block) return null;
    const x509 = new X509Certificate(block[0]);
    const d = new Date(x509.validTo);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

export function parseCertExpiryFromPath(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return parseCertExpiryFromPem(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Keep at most one certificate row per domain (newest wins). */
export function upsertCertificateRow(
  db: YskDatabase,
  row: StoredCertificate,
): StoredCertificate {
  const domain = row.domain.toLowerCase();
  const others = db.snapshot.certificates.filter((c) => String(c.domain).toLowerCase() !== domain);
  db.snapshot.certificates = [row as unknown as Record<string, unknown>, ...others].slice(0, 100);
  db.persist();
  return row;
}

/**
 * Write cert files under dataDir/certs/<domain>/ and register in store (1 row / domain).
 */
export function uploadCertificate(input: {
  db: YskDatabase;
  dataDir: string;
  domain: string;
  fullchainPem: string;
  privkeyPem: string;
  actor: string;
}): StoredCertificate {
  const domain = normalizeDomain(input.domain);
  validatePemBundle(input.fullchainPem, input.privkeyPem);

  const dir = join(input.dataDir, 'certs', domain);
  mkdirSync(dir, { recursive: true });
  const fullchain_path = join(dir, 'fullchain.pem');
  const privkey_path = join(dir, 'privkey.pem');
  writeFileSync(fullchain_path, input.fullchainPem.trim() + '\n', { mode: 0o644 });
  writeFileSync(privkey_path, input.privkeyPem.trim() + '\n', { mode: 0o600 });

  const now = new Date().toISOString();
  const expires = parseCertExpiryFromPem(input.fullchainPem);
  const existing = findCertForDomain(input.db, domain);
  const row: StoredCertificate = {
    id: existing?.id ?? randomUUID(),
    domain,
    provider: 'upload',
    fullchain_path,
    privkey_path,
    apply_status: 'uploaded',
    ok: true,
    notes: [`憑證檔已寫入 ${dir}`],
    created_at: existing?.created_at ?? now,
    updated_at: now,
    actor: input.actor,
    expires_at: expires ?? undefined,
  };

  return upsertCertificateRow(input.db, row);
}

/** Upsert LE plan / result without inventing a second row for the same domain. */
export function upsertLetsEncryptRecord(input: {
  db: YskDatabase;
  domain: string;
  email: string;
  actor: string;
  ok: boolean;
  run: boolean;
  executed: boolean;
  commands: string[];
  notes: string[];
}): StoredCertificate {
  const domain = normalizeDomain(input.domain);
  const now = new Date().toISOString();
  const existing = findCertForDomain(input.db, domain);
  const lePaths = {
    fullchain_path: `/etc/letsencrypt/live/${domain}/fullchain.pem`,
    privkey_path: `/etc/letsencrypt/live/${domain}/privkey.pem`,
  };
  let apply_status = 'planned';
  if (input.run && input.executed && input.ok) apply_status = 'issued';
  else if (input.run && !input.ok) apply_status = 'failed';
  else if (!input.run) apply_status = 'planned';

  const row: StoredCertificate = {
    id: existing?.id ?? randomUUID(),
    domain,
    provider: 'letsencrypt',
    fullchain_path: existing?.fullchain_path ?? lePaths.fullchain_path,
    privkey_path: existing?.privkey_path ?? lePaths.privkey_path,
    apply_status,
    ok: input.ok,
    notes: input.notes,
    commands: input.commands,
    email: input.email,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    actor: input.actor,
  };
  return upsertCertificateRow(input.db, row);
}

export function findCertForDomain(
  db: YskDatabase,
  domain: string,
): StoredCertificate | undefined {
  const d = domain.trim().toLowerCase();
  const row = db.snapshot.certificates.find((c) => String(c.domain).toLowerCase() === d);
  return row as unknown as StoredCertificate | undefined;
}

export function resolveManagedCertPaths(
  dataDir: string,
  domain: string,
): { fullchain: string; privkey: string; exists: boolean } {
  const fullchain = join(dataDir, 'certs', domain, 'fullchain.pem');
  const privkey = join(dataDir, 'certs', domain, 'privkey.pem');
  return {
    fullchain,
    privkey,
    exists: existsSync(fullchain) && existsSync(privkey),
  };
}

export function listUploadedCertFiles(dataDir: string): Array<{
  domain: string;
  fullchain: string;
  privkey: string;
  bytes: number;
}> {
  const root = join(dataDir, 'certs');
  if (!existsSync(root)) return [];
  const out: Array<{ domain: string; fullchain: string; privkey: string; bytes: number }> = [];
  for (const domain of readdirSync(root)) {
    const fullchain = join(root, domain, 'fullchain.pem');
    const privkey = join(root, domain, 'privkey.pem');
    if (existsSync(fullchain) && existsSync(privkey)) {
      out.push({
        domain,
        fullchain,
        privkey,
        bytes: statSync(fullchain).size + statSync(privkey).size,
      });
    }
  }
  return out;
}

/**
 * One row per domain: merge registry + on-disk certs. Disk existence drives "files_exist".
 */
export function listCertificatesView(db: YskDatabase, dataDir: string): CertificateView[] {
  const byDomain = new Map<string, CertificateView>();

  // Prefer store rows first
  for (const raw of db.snapshot.certificates) {
    const domain = String(raw.domain ?? '').toLowerCase();
    if (!domain) continue;
    const paths = resolveManagedCertPaths(dataDir, domain);
    const fullchain = paths.exists
      ? paths.fullchain
      : raw.fullchain_path
        ? String(raw.fullchain_path)
        : undefined;
    const expires =
      (raw.expires_at ? String(raw.expires_at) : null) ??
      (paths.exists ? parseCertExpiryFromPath(paths.fullchain) : null);
    const provider = (raw.provider === 'letsencrypt' ? 'letsencrypt' : 'upload') as
      | 'upload'
      | 'letsencrypt';
    // Honest status: never show "applied" without local files (unless LE issued on host paths)
    let status = String(raw.apply_status ?? 'planned').toLowerCase();
    if (status === 'applied' || status === 'issued_or_planned') {
      status = paths.exists ? 'uploaded' : provider === 'letsencrypt' ? 'planned' : 'missing';
    }
    if (paths.exists && (status === 'planned' || status === 'draft' || status === 'missing')) {
      status = 'uploaded';
    }
    if (!paths.exists && status === 'uploaded') status = 'missing';
    if (!paths.exists && provider === 'letsencrypt' && status === 'issued') {
      status = 'issued'; // may live under /etc/letsencrypt
    }

    byDomain.set(domain, {
      id: String(raw.id ?? domain),
      domain,
      provider,
      status,
      files_exist: paths.exists,
      fullchain_path: fullchain,
      privkey_path: paths.exists ? paths.privkey : raw.privkey_path ? String(raw.privkey_path) : undefined,
      expires_at: expires,
      bytes: paths.exists
        ? statSync(paths.fullchain).size + statSync(paths.privkey).size
        : undefined,
      notes: Array.isArray(raw.notes) ? (raw.notes as string[]) : [],
      updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
      created_at: raw.created_at ? String(raw.created_at) : undefined,
    });
  }

  // Disk-only domains
  for (const f of listUploadedCertFiles(dataDir)) {
    if (byDomain.has(f.domain)) {
      const cur = byDomain.get(f.domain)!;
      cur.files_exist = true;
      cur.fullchain_path = f.fullchain;
      cur.privkey_path = f.privkey;
      cur.bytes = f.bytes;
      cur.expires_at = cur.expires_at ?? parseCertExpiryFromPath(f.fullchain);
      if (cur.status === 'planned' || cur.status === 'missing' || cur.status === 'draft') {
        cur.status = 'uploaded';
      }
      continue;
    }
    byDomain.set(f.domain, {
      id: `disk-${f.domain}`,
      domain: f.domain,
      provider: 'upload',
      status: 'uploaded',
      files_exist: true,
      fullchain_path: f.fullchain,
      privkey_path: f.privkey,
      expires_at: parseCertExpiryFromPath(f.fullchain),
      bytes: f.bytes,
      notes: [],
    });
  }

  return [...byDomain.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

/**
 * Delete managed cert files + all store rows for that domain (or by id).
 */
export function deleteCertificate(
  db: YskDatabase,
  dataDir: string,
  idOrDomain: string,
): { ok: boolean; domain: string; notes: string[] } {
  const notes: string[] = [];
  let domain = idOrDomain.trim().toLowerCase();
  const byId = db.snapshot.certificates.find((c) => String(c.id) === idOrDomain);
  if (byId) domain = String(byId.domain).toLowerCase();
  else if (domain.startsWith('disk-')) domain = domain.slice(5);

  if (!domain) {
    return { ok: false, domain: '', notes: ['domain not found'] };
  }

  const certDir = join(dataDir, 'certs', domain);
  if (existsSync(certDir)) {
    rmSync(certDir, { recursive: true, force: true });
    notes.push(`已刪除 ${certDir}`);
  } else {
    notes.push('本地無憑證檔（或從未上傳）');
  }

  const before = db.snapshot.certificates.length;
  db.snapshot.certificates = db.snapshot.certificates.filter(
    (c) => String(c.domain).toLowerCase() !== domain,
  );
  const removed = before - db.snapshot.certificates.length;
  notes.push(removed > 0 ? `已移除 ${removed} 筆登記` : '無登記紀錄');
  db.persist();
  return { ok: true, domain, notes };
}

/** Dedupe existing polluted store (same domain many rows). */
export function dedupeCertificatesInStore(db: YskDatabase): number {
  const best = new Map<string, Record<string, unknown>>();
  for (const c of db.snapshot.certificates) {
    const d = String(c.domain ?? '').toLowerCase();
    if (!d) continue;
    const prev = best.get(d);
    if (!prev) {
      best.set(d, c);
      continue;
    }
    const prevT = String(prev.updated_at ?? prev.created_at ?? '');
    const curT = String(c.updated_at ?? c.created_at ?? '');
    if (curT >= prevT) best.set(d, c);
  }
  const next = [...best.values()];
  const removed = db.snapshot.certificates.length - next.length;
  db.snapshot.certificates = next;
  if (removed > 0) db.persist();
  return removed;
}

/** Read PEM for tests / verification without exposing in API by default */
export function readCertSnippet(path: string, max = 80): string {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8').slice(0, max);
}
