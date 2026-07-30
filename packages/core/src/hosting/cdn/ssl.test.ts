import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import { uploadCertificate } from '../ssl-certs.js';
import { upsertCdnNode } from './nodes.js';
import { upsertCdnSite } from './sites.js';
import { renderCdnEdgeNginxConf } from './edge-render.js';
import {
  resolveCdnSiteCertificate,
  distributeCdnSiteSsl,
  edgeSslPaths,
} from './ssl.js';
import type { HostExecutor } from '../../host/executor.js';
import type { CdnSiteDto } from '@ysk/shared';

// Same minimal PEMs as ssl-certs.test (regex-only validation)
const SAMPLE_CERT = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHBfP8rX0example
-----END CERTIFICATE-----
`;
const SAMPLE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC
-----END PRIVATE KEY-----
`;

function baseSite(over: Partial<CdnSiteDto> & { id: string }): CdnSiteDto {
  return {
    name: 's',
    domains: ['cdn.example.com'],
    mode: 'origin_pull',
    origin: { kind: 'url', url: 'https://origin.example.com' },
    edgeNodeIds: ['e1'],
    dns: {
      strategy: 'multi_a',
      ttlHealthy: 60,
      ttlUnhealthy: 30,
      minHealthyEdges: 1,
    },
    cache: { enabled: true, zoneSize: '10m', maxAge: '10m' },
    ssl: { mode: 'upload' },
    apply_status: 'draft',
    edge_status: {},
    ...over,
  };
}

describe('cdn ssl (PR-C6)', () => {
  it('renders TLS server block with cert paths', () => {
    const site = baseSite({ id: 's1' });
    const r = renderCdnEdgeNginxConf({
      site,
      sslPaths: edgeSslPaths(site.id),
    });
    expect(r.sslEnabled).toBe(true);
    expect(r.conf).toContain('listen 443 ssl');
    expect(r.conf).toContain(
      'ssl_certificate /etc/ysk-cdn/certs/s1/fullchain.pem',
    );
    expect(r.conf).toContain('return 301 https://');
    expect(r.conf).toContain('acme-challenge');
  });

  it('renders acme-only HTTP conf', () => {
    const site = baseSite({
      id: 's2',
      domains: ['a.example.com'],
      ssl: { mode: 'le_http01' },
    });
    const r = renderCdnEdgeNginxConf({ site, acmeOnly: true });
    expect(r.sslEnabled).toBe(false);
    expect(r.conf).toContain('acme-challenge');
    expect(r.conf).not.toContain('listen 443');
  });

  it('resolves uploaded cert and stages + renders TLS conf', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const cert = uploadCertificate({
        db,
        dataDir: dir,
        domain: 'cdn.example.com',
        fullchainPem: SAMPLE_CERT,
        privkeyPem: SAMPLE_KEY,
        actor: 'test',
      });
      const edge = upsertCdnNode(db, {
        name: 'local',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'site',
        domains: ['cdn.example.com'],
        origin: { kind: 'url', url: 'https://origin.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'upload', certId: cert.id },
      });

      const resolved = resolveCdnSiteCertificate({ db, dataDir: dir, site });
      expect(resolved.ok).toBe(true);

      const host: HostExecutor = {
        executeEnabled: () => true,
        isRoot: () => true,
        pathExists: () => false,
        readFile: async () => '',
        listDir: async () => [],
        writeFile: async () => undefined,
        deletePath: async () => undefined,
        mkdirp: async () => undefined,
        sysInfo: async () => ({}),
        serviceStatus: async () => ({
          stdout: '',
          stderr: '',
          exitCode: 0,
          argv: [],
          dryRun: false,
        }),
        runCommand: async (argv) => ({
          stdout: '',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        }),
      };

      const r = await distributeCdnSiteSsl({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
        applyNginx: false,
      });
      expect(r.cert?.ok).toBe(true);
      const stage = join(
        dir,
        'cdn',
        'sites',
        site.id,
        'certs',
        'fullchain.pem',
      );
      expect(existsSync(stage)).toBe(true);
      const conf = join(dir, 'cdn', 'sites', site.id, 'edge.conf');
      expect(existsSync(conf)).toBe(true);
      expect(readFileSync(conf, 'utf8')).toContain('ssl_certificate');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
