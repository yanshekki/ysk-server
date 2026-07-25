/**
 * User-uploaded SSL certificates + managed cert registry under dataDir/certs.
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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

/**
 * Write cert files under dataDir/certs/<domain>/ and register in store.
 */
export function uploadCertificate(input: {
  db: YskDatabase;
  dataDir: string;
  domain: string;
  fullchainPem: string;
  privkeyPem: string;
  actor: string;
}): StoredCertificate {
  const domain = input.domain.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(domain) || domain.length < 3) {
    throw new YskError(ErrorCodes.VALIDATION, 'Invalid domain', { httpStatus: 400 });
  }
  validatePemBundle(input.fullchainPem, input.privkeyPem);

  const dir = join(input.dataDir, 'certs', domain);
  mkdirSync(dir, { recursive: true });
  const fullchain_path = join(dir, 'fullchain.pem');
  const privkey_path = join(dir, 'privkey.pem');
  writeFileSync(fullchain_path, input.fullchainPem.trim() + '\n', { mode: 0o644 });
  writeFileSync(privkey_path, input.privkeyPem.trim() + '\n', { mode: 0o600 });

  const now = new Date().toISOString();
  const row: StoredCertificate = {
    id: randomUUID(),
    domain,
    provider: 'upload',
    fullchain_path,
    privkey_path,
    apply_status: 'uploaded',
    ok: true,
    notes: [`Stored under ${dir}`, 'Use publish-nginx with ssl:true to reference these paths'],
    created_at: now,
    updated_at: now,
    actor: input.actor,
  };

  // replace prior upload for same domain
  input.db.snapshot.certificates = input.db.snapshot.certificates.filter(
    (c) => String(c.domain) !== domain || c.provider !== 'upload',
  );
  input.db.snapshot.certificates.unshift(row as unknown as Record<string, unknown>);
  if (input.db.snapshot.certificates.length > 100) {
    input.db.snapshot.certificates = input.db.snapshot.certificates.slice(0, 100);
  }
  input.db.persist();
  return row;
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

/** Read PEM for tests / verification without exposing in API by default */
export function readCertSnippet(path: string, max = 80): string {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8').slice(0, max);
}
