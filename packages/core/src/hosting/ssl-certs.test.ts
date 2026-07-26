import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import {
  uploadCertificate,
  resolveManagedCertPaths,
  validatePemBundle,
  listUploadedCertFiles,
  listCertificatesView,
  deleteCertificate,
  upsertLetsEncryptRecord,
  dedupeCertificatesInStore,
} from './ssl-certs.js';
import { YskError } from '@ysk/shared';

const SAMPLE_CERT = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHBfP8rX0example
-----END CERTIFICATE-----
`;
const SAMPLE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC
-----END PRIVATE KEY-----
`;

describe('ssl certs real lifecycle', () => {
  it('validates PEM and stores under dataDir once per domain', () => {
    expect(() => validatePemBundle(SAMPLE_CERT, SAMPLE_KEY)).not.toThrow();
    expect(() => validatePemBundle('not-pem', SAMPLE_KEY)).toThrow(YskError);

    const dir = mkdtempSync(join(tmpdir(), 'ysk-ssl-'));
    try {
      const db = new JsonStore(join(dir, 'ysk.json'));
      const cert = uploadCertificate({
        db,
        dataDir: dir,
        domain: 'app.example.com',
        fullchainPem: SAMPLE_CERT,
        privkeyPem: SAMPLE_KEY,
        actor: 'test',
      });
      expect(cert.ok).toBe(true);
      expect(existsSync(cert.fullchain_path)).toBe(true);
      uploadCertificate({
        db,
        dataDir: dir,
        domain: 'app.example.com',
        fullchainPem: SAMPLE_CERT,
        privkeyPem: SAMPLE_KEY,
        actor: 'test',
      });
      const view = listCertificatesView(db, dir);
      expect(view.filter((c) => c.domain === 'app.example.com')).toHaveLength(1);
      expect(view[0].files_exist).toBe(true);
      expect(view[0].status).toBe('uploaded');
      expect(listUploadedCertFiles(dir).some((c) => c.domain === 'app.example.com')).toBe(true);
      expect(resolveManagedCertPaths(dir, 'app.example.com').exists).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('LE plan upserts single row; delete removes disk+store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ssl-le-'));
    try {
      const db = new JsonStore(join(dir, 'ysk.json'));
      upsertLetsEncryptRecord({
        db,
        domain: 'demo.local',
        email: 'a@demo.local',
        actor: 't',
        ok: true,
        run: false,
        executed: false,
        commands: ['certbot --nginx -d demo.local'],
        notes: ['plan'],
      });
      upsertLetsEncryptRecord({
        db,
        domain: 'demo.local',
        email: 'a@demo.local',
        actor: 't',
        ok: true,
        run: false,
        executed: false,
        commands: ['certbot --nginx -d demo.local'],
        notes: ['plan2'],
      });
      expect(db.snapshot.certificates.filter((c) => c.domain === 'demo.local')).toHaveLength(1);

      uploadCertificate({
        db,
        dataDir: dir,
        domain: 'wipe.example.com',
        fullchainPem: SAMPLE_CERT,
        privkeyPem: SAMPLE_KEY,
        actor: 't',
      });
      const del = deleteCertificate(db, dir, 'wipe.example.com');
      expect(del.ok).toBe(true);
      expect(resolveManagedCertPaths(dir, 'wipe.example.com').exists).toBe(false);
      expect(listCertificatesView(db, dir).some((c) => c.domain === 'wipe.example.com')).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dedupes polluted multi-row store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ssl-dup-'));
    try {
      const db = new JsonStore(join(dir, 'ysk.json'));
      for (let i = 0; i < 5; i++) {
        db.snapshot.certificates.push({
          id: `x-${i}`,
          domain: 'demo.local',
          provider: 'letsencrypt',
          apply_status: 'planned',
          updated_at: `2026-01-0${i}T00:00:00.000Z`,
        });
      }
      db.persist();
      const n = dedupeCertificatesInStore(db);
      expect(n).toBe(4);
      expect(db.snapshot.certificates).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
