import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import type { HostManifest } from '@yanshekki/shared';
import { createMigrateJob } from './job-store.js';
import {
  ensureRemoteDirs,
  transferMigratePayload,
  verifyRemoteYskJson,
} from './transfer.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(opts: {
  execute?: boolean;
  log?: string[];
  failPattern?: string | RegExp;
  failExit?: number;
  remoteSha?: string | null;
  mkdirFail?: boolean;
  sshStdout?: string;
  sshFail?: boolean;
}): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => true,
    executeEnabled: () => opts.execute ?? true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      const joined = argv.join(' ');
      opts.log?.push(joined);

      if (opts.failPattern) {
        const m =
          typeof opts.failPattern === 'string'
            ? joined.includes(opts.failPattern)
            : opts.failPattern.test(joined);
        if (m) {
          return {
            ...empty(),
            exitCode: opts.failExit ?? 1,
            stderr: 'forced fail',
            argv,
          };
        }
      }

      if (opts.mkdirFail && (joined.includes('mkdir') || joined.includes('YSK_MKDIR'))) {
        return { ...empty(), exitCode: 1, stderr: 'mkdir denied', argv };
      }

      if (opts.sshFail && (argv[0] === 'ssh' || joined.includes('ssh'))) {
        return { ...empty(), exitCode: 255, stderr: 'ssh fail', argv };
      }

      if (joined.includes('sha256sum') || joined.includes('YSK_SHA')) {
        if (opts.remoteSha === null) {
          return {
            ...empty(),
            exitCode: 0,
            stdout: 'not-a-hash\nYSK_SHA_DONE\n',
            argv,
          };
        }
        const sha = opts.remoteSha ?? 'deadbeef';
        return {
          ...empty(),
          exitCode: 0,
          stdout: `${sha}\nYSK_SHA_DONE\n`,
          argv,
        };
      }

      if (joined.includes('mkdir') || joined.includes('YSK_MKDIR')) {
        return {
          ...empty(),
          exitCode: 0,
          stdout: opts.sshStdout ?? 'YSK_MKDIR_OK\n',
          argv,
        };
      }

      if (joined.includes('rsync') || argv[0] === 'rsync') {
        return { ...empty(), exitCode: 0, stdout: 'sent 1\n', argv };
      }

      if (argv[0] === 'ssh' || joined.includes('ssh ')) {
        return {
          ...empty(),
          exitCode: 0,
          stdout: opts.sshStdout ?? 'YSK_MKDIR_OK\n',
          argv,
        };
      }
      return { ...empty(), argv };
    },
  };
}

function manifest(
  dataDir: string,
  homes: string[] = [],
  optionalEtc: string[] = [],
): HostManifest {
  const ysk = join(dataDir, 'ysk.json');
  let fp = '';
  try {
    fp = createHash('sha256').update(readFileSync(ysk)).digest('hex');
  } catch {
    fp = '';
  }
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    packagedAt: new Date().toISOString(),
    source: {
      hostname: 'src',
      os: 'linux',
      arch: 'x64',
      dataDir,
      yskVersion: '0.1.0',
      nodeVersion: process.version,
    },
    counts: {},
    projects: [],
    databases: [],
    redis: [],
    mailboxes: [],
    emailDomains: [],
    softwareNeeded: ['nginx'],
    paths: {
      dataDir,
      homes,
      optionalEtc,
      dataDirCritical: [],
    },
    fingerprints: fp ? { 'dataDir/ysk.json': fp } : {},
    warnings: [],
    exclusions: [],
    cutoverHostnames: [],
  };
}

describe('transfer depth — ensureRemoteDirs / verify', () => {
  it('ensureRemoteDirs empty list is ok without ssh', async () => {
    const r = await ensureRemoteDirs({
      host: mockHost({ execute: true }),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      dirs: [],
    });
    expect(r.ok).toBe(true);
  });

  it('ensureRemoteDirs with real dirs invokes ssh', async () => {
    const log: string[] = [];
    const r = await ensureRemoteDirs({
      host: mockHost({ execute: true, log }),
      endpoint: { host: '10.0.0.9', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      dirs: ['/var/lib/ysk-server', '/home'],
    });
    expect(r.ok).toBe(true);
    expect(log.some((l) => l.includes('ssh') || l.includes('mkdir'))).toBe(true);
  });

  it('verifyRemoteYskJson fails when remote ssh fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-trv-'));
    writeFileSync(join(dir, 'ysk.json'), '{}\n');
    try {
      const r = await verifyRemoteYskJson({
        host: mockHost({ execute: true, sshFail: true }),
        endpoint: { host: 'h', port: 22, user: 'root' },
        auth: { kind: 'agent' },
        localDataDir: dir,
        targetDataDir: '/var/lib/ysk-server',
      });
      expect(r.ok).toBe(false);
      expect(r.localSha).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('verifyRemoteYskJson fails when remote has no sha line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-trv2-'));
    writeFileSync(join(dir, 'ysk.json'), '{}\n');
    try {
      const r = await verifyRemoteYskJson({
        host: mockHost({ execute: true, remoteSha: null }),
        endpoint: { host: 'h', port: 22, user: 'root' },
        auth: { kind: 'agent' },
        localDataDir: dir,
        targetDataDir: '/var/lib/ysk-server',
      });
      expect(r.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('verifyRemoteYskJson accepts expectedSha override', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-trv3-'));
    writeFileSync(join(dir, 'ysk.json'), 'x\n');
    try {
      const expected = 'a'.repeat(64);
      const r = await verifyRemoteYskJson({
        host: mockHost({ execute: true, remoteSha: expected }),
        endpoint: { host: 'h', port: 22, user: 'root' },
        auth: { kind: 'agent' },
        localDataDir: dir,
        targetDataDir: '/var/lib/ysk-server',
        expectedSha: expected,
      });
      expect(r.ok).toBe(true);
      expect(r.remoteSha).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('transfer depth — transferMigratePayload branches', () => {
  let dir: string;
  let home: string;
  let etcPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-trd-'));
    writeFileSync(join(dir, 'ysk.json'), '{"v":1}\n');
    home = join(dir, 'external-home');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'app.js'), '1\n');
    etcPath = join(dir, 'fake-etc-le');
    mkdirSync(etcPath, { recursive: true });
    writeFileSync(join(etcPath, 'cert.pem'), 'c\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('warns when packagedAt missing (non-dry)', async () => {
    const sha = createHash('sha256')
      .update(readFileSync(join(dir, 'ysk.json')))
      .digest('hex');
    const m = manifest(dir);
    delete (m as { packagedAt?: string }).packagedAt;
    m.fingerprints['dataDir/ysk.json'] = sha;
    const r = await transferMigratePayload({
      host: mockHost({ execute: true, remoteSha: sha }),
      dataDir: dir,
      job: createMigrateJob({ dataDir: dir, maintenanceAccepted: true }),
      manifest: m,
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
    });
    expect(r.ok).toBe(true);
    expect(r.items.some((i) => i.id === 'package-check')).toBe(true);
  });

  it('fails when remote mkdir fails', async () => {
    const r = await transferMigratePayload({
      host: mockHost({ execute: true, mkdirFail: true }),
      dataDir: dir,
      job: createMigrateJob({ dataDir: dir, maintenanceAccepted: true }),
      manifest: manifest(dir),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
    });
    expect(r.ok).toBe(false);
    expect(r.items.some((i) => i.id === 'mkdir' && !i.ok)).toBe(true);
  });

  it('fails when dataDir missing', async () => {
    // Use a path that job helpers can write under (parent exists) but payload root is a file
    const fileAsDir = join(dir, 'not-a-dir-file');
    writeFileSync(fileAsDir, 'x');
    // Actually transfer checks existsSync(dataDir) only — non-existing path:
    // setMigratePhase may create parents; assert overall honesty fail.
    const missing = join(dir, 'deeply', 'missing', 'data');
    const r = await transferMigratePayload({
      host: mockHost({ execute: true }),
      dataDir: missing,
      job: createMigrateJob({ dataDir: dir, maintenanceAccepted: true }),
      manifest: manifest(dir),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
    });
    expect(r.ok).toBe(false);
    expect(
      r.items.some((i) => i.kind === 'dataDir' && !i.ok) ||
        r.apply_status === 'failed' ||
        r.notes.length > 0,
    ).toBe(true);
  });

  it('fails when dataDir rsync fails', async () => {
    const r = await transferMigratePayload({
      host: mockHost({ execute: true, failPattern: 'rsync' }),
      dataDir: dir,
      job: createMigrateJob({ dataDir: dir, maintenanceAccepted: true }),
      manifest: manifest(dir),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
    });
    expect(r.ok).toBe(false);
    expect(r.items.some((i) => i.id === 'dataDir' && !i.ok)).toBe(true);
  });

  it('skips missing home and home under dataDir', async () => {
    const sha = createHash('sha256')
      .update(readFileSync(join(dir, 'ysk.json')))
      .digest('hex');
    const nested = join(dir, 'nested-home');
    mkdirSync(nested, { recursive: true });
    const m = manifest(dir, [join(dir, 'gone-home'), nested, home]);
    m.fingerprints['dataDir/ysk.json'] = sha;
    const r = await transferMigratePayload({
      host: mockHost({ execute: true, remoteSha: sha }),
      dataDir: dir,
      job: createMigrateJob({ dataDir: dir, maintenanceAccepted: true }),
      manifest: m,
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
    });
    expect(r.ok).toBe(true);
    expect(r.items.some((i) => i.id.includes('gone-home') && i.ok)).toBe(true);
    expect(r.items.some((i) => i.id.includes('nested-home') && i.ok)).toBe(true);
    // home is under dataDir → skip-rsync note path
    expect(r.items.some((i) => i.id === `home:${home}` && i.ok)).toBe(true);
  });

  it('rsyncs external home outside dataDir and fails when that rsync fails', async () => {
    // home must be outside dataDir so transfer actually rsyncs it
    const outside = mkdtempSync(join(tmpdir(), 'ysk-tr-home-'));
    writeFileSync(join(outside, 'app.js'), '1\n');
    try {
      const sha = createHash('sha256')
        .update(readFileSync(join(dir, 'ysk.json')))
        .digest('hex');
      const okHost = mockHost({ execute: true, remoteSha: sha });
      const ok = await transferMigratePayload({
        host: okHost,
        dataDir: dir,
        job: createMigrateJob({ dataDir: dir, maintenanceAccepted: true }),
        manifest: manifest(dir, [outside]),
        endpoint: { host: 'h', port: 22, user: 'root' },
        auth: { kind: 'agent' },
      });
      expect(ok.ok).toBe(true);
      expect(ok.items.some((i) => i.id === `home:${outside}` && i.ok)).toBe(true);

      const failHost: HostExecutor = {
        ...mockHost({ execute: true }),
        runCommand: async (argv) => {
          const joined = argv.join(' ');
          if (joined.includes('rsync') || argv[0] === 'rsync') {
            if (joined.includes(outside)) {
              return { ...empty(), exitCode: 1, stderr: 'home rsync fail', argv };
            }
            return { ...empty(), exitCode: 0, stdout: 'ok', argv };
          }
          if (joined.includes('mkdir') || joined.includes('YSK_MKDIR')) {
            return { ...empty(), exitCode: 0, stdout: 'YSK_MKDIR_OK\n', argv };
          }
          return { ...empty(), argv };
        },
      };
      const bad = await transferMigratePayload({
        host: failHost,
        dataDir: dir,
        job: createMigrateJob({ dataDir: dir, maintenanceAccepted: true }),
        manifest: manifest(dir, [outside]),
        endpoint: { host: 'h', port: 22, user: 'root' },
        auth: { kind: 'agent' },
      });
      expect(bad.ok).toBe(false);
      expect(bad.items.some((i) => i.kind === 'home' && !i.ok)).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('optionalEtc missing is ok; failure is non-fatal', async () => {
    const sha = createHash('sha256')
      .update(readFileSync(join(dir, 'ysk.json')))
      .digest('hex');
    let rsyncN = 0;
    const host: HostExecutor = {
      ...mockHost({ execute: true, remoteSha: sha }),
      runCommand: async (argv) => {
        const joined = argv.join(' ');
        if (joined.includes('sha256sum') || joined.includes('YSK_SHA')) {
          return {
            ...empty(),
            exitCode: 0,
            stdout: `${sha}\nYSK_SHA_DONE\n`,
            argv,
          };
        }
        if (joined.includes('rsync') || argv[0] === 'rsync') {
          rsyncN += 1;
          // dataDir=1, etc=2 → fail etc
          if (rsyncN >= 2) {
            return { ...empty(), exitCode: 1, stderr: 'etc fail', argv };
          }
          return { ...empty(), exitCode: 0, stdout: 'ok', argv };
        }
        if (joined.includes('mkdir') || joined.includes('YSK_MKDIR')) {
          return { ...empty(), exitCode: 0, stdout: 'YSK_MKDIR_OK\n', argv };
        }
        return { ...empty(), argv };
      },
    };
    const m = manifest(dir, [], [join(dir, 'missing-etc'), etcPath]);
    m.fingerprints['dataDir/ysk.json'] = sha;
    const r = await transferMigratePayload({
      host,
      dataDir: dir,
      job: createMigrateJob({ dataDir: dir, maintenanceAccepted: true }),
      manifest: m,
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
    });
    // optionalEtc fail is non-fatal → overall ok
    expect(r.ok).toBe(true);
    expect(r.items.some((i) => i.kind === 'optionalEtc' && i.id.includes('missing-etc'))).toBe(
      true,
    );
    const failedEtc = r.items.find((i) => i.id === `etc:${etcPath}`);
    expect(failedEtc && !failedEtc.ok).toBe(true);
  });

  it('includeOptionalEtc=false skips etc paths', async () => {
    const sha = createHash('sha256')
      .update(readFileSync(join(dir, 'ysk.json')))
      .digest('hex');
    const m = manifest(dir, [], [etcPath]);
    m.fingerprints['dataDir/ysk.json'] = sha;
    const r = await transferMigratePayload({
      host: mockHost({ execute: true, remoteSha: sha }),
      dataDir: dir,
      job: createMigrateJob({ dataDir: dir, maintenanceAccepted: true }),
      manifest: m,
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      includeOptionalEtc: false,
    });
    expect(r.ok).toBe(true);
    expect(r.items.every((i) => i.kind !== 'optionalEtc')).toBe(true);
  });

  it('uses job.targetDataDir default when not passed', async () => {
    const sha = createHash('sha256')
      .update(readFileSync(join(dir, 'ysk.json')))
      .digest('hex');
    const job = createMigrateJob({
      dataDir: dir,
      maintenanceAccepted: true,
      targetDataDir: '/opt/ysk-custom',
    });
    const m = manifest(dir);
    m.fingerprints['dataDir/ysk.json'] = sha;
    const r = await transferMigratePayload({
      host: mockHost({ execute: true, remoteSha: sha }),
      dataDir: dir,
      job,
      manifest: m,
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
    });
    expect(r.ok).toBe(true);
    expect(r.targetDataDir).toBe('/opt/ysk-custom');
    expect(existsSync(join(dir, 'ysk.json'))).toBe(true);
  });
});
