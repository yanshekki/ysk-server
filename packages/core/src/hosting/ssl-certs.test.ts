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

describe('ssl certs upload', () => {
  it('validates PEM and stores under dataDir', () => {
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
      expect(existsSync(cert.privkey_path)).toBe(true);
      const paths = resolveManagedCertPaths(dir, 'app.example.com');
      expect(paths.exists).toBe(true);
      expect(listUploadedCertFiles(dir).some((c) => c.domain === 'app.example.com')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
