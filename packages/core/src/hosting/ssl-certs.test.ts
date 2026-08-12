import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import {
  uploadCertificate,
  resolveManagedCertPaths,
  resolveBestCertPaths,
  resolveLetsEncryptLivePaths,
  probeCertbotTimerUnitFiles,
  validatePemBundle,
  listUploadedCertFiles,
  listCertificatesView,
  deleteCertificate,
  upsertLetsEncryptRecord,
  dedupeCertificatesInStore,
  normalizeDomain,
  parseCertExpiryFromPem,
  parseCertExpiryFromPath,
  readCertSnippet,
} from './ssl-certs.js';
import { YskError } from 'ysk-server-shared';

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

  it('normalizeDomain / PEM / expiry edge branches', () => {
    expect(normalizeDomain('  EXAMPLE.COM. ')).toBe('example.com');
    expect(normalizeDomain('*.cdn.example.com')).toBe('*.cdn.example.com');
    expect(() => normalizeDomain('*.')).toThrow(YskError);
    expect(() => normalizeDomain('*.a..b')).toThrow(YskError);
    expect(() => normalizeDomain('ab')).toThrow(YskError);
    expect(() => normalizeDomain('bad..dot.com')).toThrow(YskError);
    expect(() => validatePemBundle(SAMPLE_CERT, 'not-a-key')).toThrow(YskError);
    expect(
      validatePemBundle(
        SAMPLE_CERT,
        `-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----`,
      ),
    ).toBeUndefined();
    expect(parseCertExpiryFromPem('no cert here')).toBeNull();
    expect(parseCertExpiryFromPem(SAMPLE_CERT)).toBeNull(); // sample is not valid x509
    expect(parseCertExpiryFromPath('/no/such/cert.pem')).toBeNull();
    expect(readCertSnippet('/missing.pem')).toBe('');
  });

  it('resolveBestCertPaths prefers managed then LE live paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ssl-best-'));
    try {
      const domain = 'best.example.com';
      const managedDir = join(dir, 'certs', domain);
      mkdirSync(managedDir, { recursive: true });
      writeFileSync(join(managedDir, 'fullchain.pem'), SAMPLE_CERT);
      writeFileSync(join(managedDir, 'privkey.pem'), SAMPLE_KEY);
      const best = resolveBestCertPaths(dir, domain);
      expect(best.exists).toBe(true);
      expect(best.location).toBe('managed');
      expect(resolveLetsEncryptLivePaths('no-such-domain-xyz.example').exists).toBe(
        false,
      );
      expect(probeCertbotTimerUnitFiles()).toMatchObject({
        unitFound: expect.any(Boolean),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('listCertificatesView status merge + disk-only + delete by id/disk-', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ssl-view-'));
    try {
      const db = new JsonStore(join(dir, 'ysk.json'));
      // empty domain skipped
      db.snapshot.certificates.push({ id: 'empty', domain: '', apply_status: 'planned' });
      // LE planned without files
      db.snapshot.certificates.push({
        id: 'le1',
        domain: 'le.example.com',
        provider: 'letsencrypt',
        apply_status: 'applied',
        fullchain_path: '/etc/letsencrypt/live/le.example.com/fullchain.pem',
        privkey_path: '/etc/letsencrypt/live/le.example.com/privkey.pem',
        notes: 'not-array',
      });
      // upload marked uploaded but missing files
      db.snapshot.certificates.push({
        id: 'up-miss',
        domain: 'miss.example.com',
        provider: 'upload',
        apply_status: 'uploaded',
      });
      // issued LE without local files stays issued
      db.snapshot.certificates.push({
        id: 'le-iss',
        domain: 'issued.example.com',
        provider: 'letsencrypt',
        apply_status: 'issued',
      });
      // status issued_or_planned with files → uploaded
      uploadCertificate({
        db,
        dataDir: dir,
        domain: 'hasfiles.example.com',
        fullchainPem: SAMPLE_CERT,
        privkeyPem: SAMPLE_KEY,
        actor: 't',
      });
      const has = db.snapshot.certificates.find((c) => c.domain === 'hasfiles.example.com')!;
      has.apply_status = 'issued_or_planned';
      // disk-only domain
      const diskOnly = join(dir, 'certs', 'diskonly.example.com');
      mkdirSync(diskOnly, { recursive: true });
      writeFileSync(join(diskOnly, 'fullchain.pem'), SAMPLE_CERT);
      writeFileSync(join(diskOnly, 'privkey.pem'), SAMPLE_KEY);

      const view = listCertificatesView(db, dir);
      expect(view.some((v) => v.domain === 'le.example.com' && v.status === 'planned')).toBe(true);
      expect(view.some((v) => v.domain === 'miss.example.com' && v.status === 'missing')).toBe(true);
      expect(view.some((v) => v.domain === 'issued.example.com' && v.status === 'issued')).toBe(true);
      expect(view.some((v) => v.domain === 'hasfiles.example.com' && v.files_exist)).toBe(true);
      expect(view.some((v) => v.domain === 'diskonly.example.com' && v.id.startsWith('disk-'))).toBe(
        true,
      );

      // LE upsert statuses
      upsertLetsEncryptRecord({
        db,
        domain: 'le2.example.com',
        email: 'a@b.c',
        actor: 't',
        ok: true,
        run: true,
        executed: true,
        commands: [],
        notes: ['ok'],
      });
      expect(
        db.snapshot.certificates.find((c) => c.domain === 'le2.example.com')?.apply_status,
      ).toBe('issued');
      upsertLetsEncryptRecord({
        db,
        domain: 'le3.example.com',
        email: 'a@b.c',
        actor: 't',
        ok: false,
        run: true,
        executed: false,
        commands: [],
        notes: ['fail'],
      });
      expect(
        db.snapshot.certificates.find((c) => c.domain === 'le3.example.com')?.apply_status,
      ).toBe('failed');

      // delete by id
      const byId = deleteCertificate(db, dir, 'up-miss');
      expect(byId.ok).toBe(true);
      expect(byId.domain).toBe('miss.example.com');
      // delete disk- prefix without store row
      const byDisk = deleteCertificate(db, dir, 'disk-diskonly.example.com');
      expect(byDisk.ok).toBe(true);
      expect(byDisk.domain).toBe('diskonly.example.com');
      // empty domain
      expect(deleteCertificate(db, dir, '   ').ok).toBe(false);
      // delete missing files path notes
      const delNone = deleteCertificate(db, dir, 'ghost.example.com');
      expect(delNone.ok).toBe(true);
      expect(delNone.notes.length).toBeGreaterThan(0);

      // dedupe empty domain + no-op
      db.snapshot.certificates.push({ id: 'e', domain: '', apply_status: 'x' });
      expect(dedupeCertificatesInStore(db)).toBeGreaterThanOrEqual(0);
      expect(listUploadedCertFiles(join(dir, 'empty-certs-root'))).toEqual([]);
      expect(readCertSnippet(join(dir, 'certs', 'hasfiles.example.com', 'fullchain.pem'), 20).length).toBeLessThanOrEqual(20);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
