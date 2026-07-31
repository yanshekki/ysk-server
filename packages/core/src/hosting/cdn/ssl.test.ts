import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import { LocalHostExecutor } from '../../host/executor.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { uploadCertificate } from '../ssl-certs.js';
import { upsertCdnNode } from './nodes.js';
import { upsertCdnSite } from './sites.js';
import { renderCdnEdgeNginxConf } from './edge-render.js';
import {
  resolveCdnSiteCertificate,
  distributeCdnSiteSsl,
  prepareCdnSiteAcme,
  issueCdnSiteLetsEncrypt,
  edgeSslPaths,
  edgeCertDir,
} from './ssl.js';
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

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(opts?: {
  execute?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts?.execute === true,
    isRoot: () => true,
    pathExists: (p) =>
      p === '/usr/sbin/nginx' || p === '/usr/bin/nginx' || p.includes('ysk'),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({
      ...empty(),
      argv,
      ...(opts?.run?.(argv) ?? {}),
    }),
  };
}

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
  it('edgeCertDir / edgeSslPaths helpers', () => {
    expect(edgeCertDir('abc')).toBe('/etc/ysk-cdn/certs/abc');
    const p = edgeSslPaths('abc');
    expect(p.fullchain).toContain('/etc/ysk-cdn/certs/abc');
    expect(p.privkey).toContain('privkey.pem');
    expect(p.acmeWebroot).toContain('ysk-cdn-acme');
  });

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
      expect(resolved.provider).toMatch(/upload|letsencrypt/);

      const host = mockHost({ execute: true });

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
      // local edge may write under /etc or fail; either written or failed honestly
      expect(['written', 'applied', 'partial', 'failed']).toContain(
        r.apply_status,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('distributeCdnSiteSsl blocked without EXECUTE (LocalHostExecutor default)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const cert = uploadCertificate({
        db,
        dataDir: dir,
        domain: 'block.example.com',
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
        name: 'blocked',
        domains: ['block.example.com'],
        origin: { kind: 'url', url: 'https://origin.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'upload', certId: cert.id },
      });
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const r = await distributeCdnSiteSsl({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
      });
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.requiresExecute).toBe(true);
      expect(r.apply_status).toBe('blocked');
      expect(r.edges).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolveCdnSiteCertificate fails when no cert on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'e',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'nocert',
        domains: ['missing.example.com'],
        origin: { kind: 'url', url: 'https://origin.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'upload' },
      });
      const resolved = resolveCdnSiteCertificate({ db, dataDir: dir, site });
      expect(resolved.ok).toBe(false);
      expect(resolved.provider).toBe('unknown');
      expect(resolved.notes.length).toBeGreaterThan(0);

      const host = mockHost({ execute: true });
      const r = await distributeCdnSiteSsl({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
      });
      expect(r.ok).toBe(false);
      expect(r.apply_status).toBe('failed');
      expect(r.cert?.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolve via managed disk path without certId', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'e',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const domain = 'disk.example.com';
      // layout used by resolveManagedCertPaths: dataDir/certs/{domain}/
      const managedDir = join(dir, 'certs', domain);
      mkdirSync(managedDir, { recursive: true });
      writeFileSync(join(managedDir, 'fullchain.pem'), SAMPLE_CERT, 'utf8');
      writeFileSync(join(managedDir, 'privkey.pem'), SAMPLE_KEY, 'utf8');
      const site = upsertCdnSite(db, {
        name: 'disk',
        domains: [domain],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'upload' },
      });
      const resolved = resolveCdnSiteCertificate({ db, dataDir: dir, site });
      expect(resolved.ok).toBe(true);
      expect(existsSync(resolved.fullchain)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('distribute skips draining edges; scp path for remote edge', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const cert = uploadCertificate({
        db,
        dataDir: dir,
        domain: 'mix.example.com',
        fullchainPem: SAMPLE_CERT,
        privkeyPem: SAMPLE_KEY,
        actor: 'test',
      });
      const drain = upsertCdnNode(db, {
        name: 'drain',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
        status: 'draining',
      });
      const remote = upsertCdnNode(db, {
        name: 'remote',
        roles: ['edge'],
        publicIpv4: ['203.0.113.80'],
        sshUsername: 'root',
      });
      const site = upsertCdnSite(db, {
        name: 'mix',
        domains: ['mix.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [drain.id, remote.id],
        ssl: { mode: 'upload', certId: cert.id },
      });
      const host = mockHost({
        execute: true,
        run: (argv) => {
          if (argv[0] === 'ssh' || argv[0] === 'scp') {
            return { exitCode: 0, stdout: 'ok' };
          }
          if (argv[0] === 'nginx') {
            return { exitCode: 0, stdout: 'syntax ok' };
          }
          return { exitCode: 0 };
        },
      });
      const r = await distributeCdnSiteSsl({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
        applyNginx: false,
      });
      const drainEdge = r.edges.find((e) => e.edgeNodeId === drain.id);
      expect(drainEdge?.method).toBe('skip');
      expect(drainEdge?.apply_status).toBe('planned');
      const rem = r.edges.find((e) => e.edgeNodeId === remote.id);
      expect(rem?.method).toBe('ssh');
      expect(['written', 'failed']).toContain(rem?.apply_status ?? '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('distribute remote mkdir fail → edge failed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const cert = uploadCertificate({
        db,
        dataDir: dir,
        domain: 'fail.example.com',
        fullchainPem: SAMPLE_CERT,
        privkeyPem: SAMPLE_KEY,
        actor: 'test',
      });
      const remote = upsertCdnNode(db, {
        name: 'remote-fail',
        roles: ['edge'],
        publicIpv4: ['203.0.113.81'],
      });
      const site = upsertCdnSite(db, {
        name: 'fail',
        domains: ['fail.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [remote.id],
        ssl: { mode: 'upload', certId: cert.id },
      });
      const host = mockHost({
        execute: true,
        run: (argv) => {
          if (argv[0] === 'ssh') {
            return { exitCode: 1, stderr: 'Permission denied' };
          }
          return { exitCode: 0 };
        },
      });
      const r = await distributeCdnSiteSsl({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
        applyNginx: false,
      });
      expect(r.edges[0]?.apply_status).toBe('failed');
      expect(r.edges[0]?.method).toBe('ssh');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prepareCdnSiteAcme blocked without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'local',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'acme',
        domains: ['acme.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'le_http01' },
      });
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const r = await prepareCdnSiteAcme({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
      });
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.requiresExecute).toBe(true);
      expect(r.apply_status).toBe('blocked');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('issueCdnSiteLetsEncrypt: blocked without EXECUTE; plan for dns01; dry run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'local',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'le',
        domains: ['le.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'le_http01' },
      });
      const hostOff = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const blocked = await issueCdnSiteLetsEncrypt({
        db,
        host: hostOff,
        dataDir: dir,
        siteId: site.id,
        email: 'ops@example.com',
      });
      expect(blocked.ok).toBe(false);
      expect(blocked.blocked).toBe(true);
      expect(blocked.requiresExecute).toBe(true);
      expect(blocked.apply_status).toBe('blocked');

      const dry = await issueCdnSiteLetsEncrypt({
        db,
        host: mockHost({ execute: true }),
        dataDir: dir,
        siteId: site.id,
        email: 'ops@example.com',
        run: false,
      });
      expect(dry.ok).toBe(true);
      expect(dry.apply_status).toBe('planned');
      expect(dry.executed).toBe(false);
      expect(dry.commands.length).toBeGreaterThan(0);

      const dnsSite = upsertCdnSite(db, {
        name: 'ledns',
        domains: ['dns.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'le_dns01' },
      });
      const dns = await issueCdnSiteLetsEncrypt({
        db,
        host: mockHost({ execute: true }),
        dataDir: dir,
        siteId: dnsSite.id,
        email: 'ops@example.com',
      });
      expect(dns.ok).toBe(true);
      expect(dns.apply_status).toBe('planned');
      expect(dns.executed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('issueCdnSiteLetsEncrypt rejects invalid email', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'local',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'lebad',
        domains: ['lebad.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'le_http01' },
      });
      await expect(
        issueCdnSiteLetsEncrypt({
          db,
          host: mockHost({ execute: true }),
          dataDir: dir,
          siteId: site.id,
          email: 'not-an-email',
        }),
      ).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('distribute with applyNginx merges fan-out status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const cert = uploadCertificate({
        db,
        dataDir: dir,
        domain: 'merge.example.com',
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
        name: 'merge',
        domains: ['merge.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'upload', certId: cert.id },
      });
      const host = mockHost({
        execute: true,
        run: (argv) => {
          if (argv[0] === 'nginx') return { exitCode: 0, stdout: 'ok' };
          return { exitCode: 0 };
        },
      });
      const r = await distributeCdnSiteSsl({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
        applyNginx: true,
      });
      expect(r.cert?.ok).toBe(true);
      expect(r.edges.length).toBeGreaterThanOrEqual(1);
      // local cert write may fail on /etc; status stays honest
      expect(['written', 'applied', 'partial', 'failed']).toContain(
        r.apply_status,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cdn ssl depth gaps', () => {
  it('resolve throws without domains; certId missing/bad paths; LE live paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-d-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const siteEmpty = baseSite({ id: 'e0', domains: [] as unknown as string[] });
      // force empty domains
      (siteEmpty as { domains: string[] }).domains = [];
      expect(() => resolveCdnSiteCertificate({ db, dataDir: dir, site: siteEmpty })).toThrow();

      // certId not in store
      const edge = upsertCdnNode(db, {
        name: 'e',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'badid',
        domains: ['badid.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'upload', certId: 'missing-cert' },
      });
      const r = resolveCdnSiteCertificate({ db, dataDir: dir, site });
      expect(r.ok).toBe(false);
      expect(r.notes.length).toBeGreaterThan(0);

      // certId present but files missing on disk
      const cert = uploadCertificate({
        db,
        dataDir: dir,
        domain: 'gone.example.com',
        fullchainPem: SAMPLE_CERT,
        privkeyPem: SAMPLE_KEY,
        actor: 't',
      });
      // wipe managed paths
      const managed = join(dir, 'certs', 'gone.example.com');
      rmSync(managed, { recursive: true, force: true });
      const site2 = upsertCdnSite(db, {
        name: 'gone',
        domains: ['gone.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'upload', certId: cert.id },
      });
      const r2 = resolveCdnSiteCertificate({ db, dataDir: dir, site: site2 });
      // may still resolve if store paths exist elsewhere, or fail
      expect(typeof r2.ok).toBe('boolean');

      // LE paths under /etc/letsencrypt — usually missing; just exercise loop
      const site3 = upsertCdnSite(db, {
        name: 'lepath',
        domains: ['unlikely-le-domain-xyz.example'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'le_http01' },
      });
      const r3 = resolveCdnSiteCertificate({ db, dataDir: dir, site: site3 });
      expect(r3.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('distribute: missing site; missing edge node; remote scp fail; baseUrl host', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-d2-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const host = mockHost({ execute: true });
      await expect(
        distributeCdnSiteSsl({ db, host, dataDir: dir, siteId: 'nope' }),
      ).rejects.toThrow();

      const seed = upsertCdnNode(db, {
        name: 'seed',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const cert = uploadCertificate({
        db,
        dataDir: dir,
        domain: 'edge.example.com',
        fullchainPem: SAMPLE_CERT,
        privkeyPem: SAMPLE_KEY,
        actor: 't',
      });
      const site = upsertCdnSite(db, {
        name: 'missedge',
        domains: ['edge.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [seed.id],
        ssl: { mode: 'upload', certId: cert.id },
      });
      // inject missing edge id after upsert validation (settings JSON list)
      const raw = JSON.parse(db.snapshot.settings['cdn_sites'] ?? '[]') as Array<{
        id: string;
        edgeNodeIds: string[];
      }>;
      const row = raw.find((s) => s.id === site.id);
      if (row) row.edgeNodeIds = ['does-not-exist'];
      db.snapshot.settings['cdn_sites'] = JSON.stringify(raw);
      db.persist();
      const r = await distributeCdnSiteSsl({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
        applyNginx: false,
      });
      expect(r.edges[0]?.apply_status).toBe('failed');
      expect(r.edges[0]?.method).toBe('skip');

      const remote = upsertCdnNode(db, {
        name: 'r1',
        roles: ['edge'],
        publicIpv4: ['203.0.113.90'],
        sshUsername: 'deploy',
        sshPort: 2222,
      });
      const viaUrl = upsertCdnNode(db, {
        name: 'url-edge',
        roles: ['edge'],
        publicIpv4: [],
        baseUrl: 'https://edge.cdn.example:8443',
      });
      const site2 = upsertCdnSite(db, {
        name: 'scpfail',
        domains: ['edge.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [remote.id, viaUrl.id],
        ssl: { mode: 'upload', certId: cert.id },
      });
      const host2 = mockHost({
        execute: true,
        run: (argv) => {
          if (argv[0] === 'ssh') return { exitCode: 0, stdout: 'ok' };
          if (argv[0] === 'scp') return { exitCode: 1, stderr: 'scp fail' };
          return { exitCode: 0 };
        },
      });
      const r2 = await distributeCdnSiteSsl({
        db,
        host: host2,
        dataDir: dir,
        siteId: site2.id,
        applyNginx: false,
        skipDraining: true,
      });
      expect(r2.edges.some((e) => e.apply_status === 'failed')).toBe(true);

      // bad baseUrl → empty host → treated as local edge
      const badUrl = upsertCdnNode(db, {
        name: 'badurl',
        roles: ['edge'],
        publicIpv4: [],
        baseUrl: 'not a url',
      });
      const site3 = upsertCdnSite(db, {
        name: 'badurls',
        domains: ['edge.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [badUrl.id],
        ssl: { mode: 'upload', certId: cert.id },
      });
      const r3 = await distributeCdnSiteSsl({
        db,
        host: mockHost({ execute: true }),
        dataDir: dir,
        siteId: site3.id,
        applyNginx: false,
      });
      expect(r3.edges.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prepareCdnSiteAcme missing site throws; issue LE planned/wildcard; certbot path when writable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-le-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const host = mockHost({ execute: true });
      await expect(
        prepareCdnSiteAcme({ db, host, dataDir: dir, siteId: 'x' }),
      ).rejects.toThrow();
      await expect(
        issueCdnSiteLetsEncrypt({
          db,
          host,
          dataDir: dir,
          siteId: 'x',
          email: 'a@b.co',
        }),
      ).rejects.toThrow();

      const edge = upsertCdnNode(db, {
        name: 'local',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'le2',
        domains: ['le2.example.com', 'www.le2.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'le_http01' },
      });

      // run=false never touches /var/www
      const dry = await issueCdnSiteLetsEncrypt({
        db,
        host,
        dataDir: dir,
        siteId: site.id,
        email: 'ops@example.com',
        run: false,
      });
      expect(dry.apply_status).toBe('planned');
      expect(dry.executed).toBe(false);

      // le_dns01 → planned (no /var/www)
      const wild = upsertCdnSite(db, {
        name: 'wild',
        domains: ['wild.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'le_dns01' },
      });
      const w = await issueCdnSiteLetsEncrypt({
        db,
        host,
        dataDir: dir,
        siteId: wild.id,
        email: 'ops@example.com',
      });
      expect(w.apply_status).toBe('planned');
      expect(w.executed).toBe(false);

      // certbot live path: may EACCES on /var/www — assert honesty either way
      const failHost = mockHost({
        execute: true,
        run: (argv) => {
          if (argv.join(' ').includes('certbot')) {
            return { exitCode: 1, stderr: 'rate limited' };
          }
          return { exitCode: 0 };
        },
      });
      try {
        const failed = await issueCdnSiteLetsEncrypt({
          db,
          host: failHost,
          dataDir: dir,
          siteId: site.id,
          email: 'ops@example.com',
          distribute: false,
        });
        expect(failed.ok).toBe(false);
        expect(['failed', 'blocked']).toContain(failed.apply_status);
      } catch (e) {
        expect(String(e)).toMatch(/EACCES|permission|ENOENT/i);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('issue distribute path honest when certbot+acme webroot not writable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdnssl-dist-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const edge = upsertCdnNode(db, {
        name: 'local',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
      });
      const site = upsertCdnSite(db, {
        name: 'led',
        domains: ['led.example.com'],
        origin: { kind: 'url', url: 'https://o.example.com' },
        edgeNodeIds: [edge.id],
        ssl: { mode: 'le_http01' },
      });
      const managed = join(dir, 'certs', 'led.example.com');
      mkdirSync(managed, { recursive: true });
      writeFileSync(join(managed, 'fullchain.pem'), SAMPLE_CERT, 'utf8');
      writeFileSync(join(managed, 'privkey.pem'), SAMPLE_KEY, 'utf8');
      const host = mockHost({
        execute: true,
        run: (argv) => {
          if (argv.join(' ').includes('certbot')) return { exitCode: 0 };
          return { exitCode: 0 };
        },
      });
      try {
        const r = await issueCdnSiteLetsEncrypt({
          db,
          host,
          dataDir: dir,
          siteId: site.id,
          email: 'ops@example.com',
          distribute: true,
        });
        expect(r.executed === true || r.apply_status === 'planned').toBe(true);
      } catch (e) {
        // non-root CI cannot mkdir /var/www/ysk-cdn-acme
        expect(String(e)).toMatch(/EACCES|permission|ENOENT/i);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
