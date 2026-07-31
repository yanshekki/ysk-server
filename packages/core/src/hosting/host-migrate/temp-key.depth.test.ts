import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../../host/executor.js';

const runSshMock = vi.fn();
vi.mock('./transport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transport.js')>();
  return {
    ...actual,
    runSshCommand: (...args: unknown[]) => runSshMock(...args),
  };
});

import {
  createMigrateTempKey,
  installTempKeyOnTarget,
  bootstrapTempKeyAuth,
  destroyLocalTempKey,
  revokeTempKeyOnTarget,
  readTempPublicKey,
} from './temp-key.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(
  run?: (argv: string[]) => Partial<RunResult> | Promise<Partial<RunResult>>,
): HostExecutor {
  return {
    pathExists: () => false,
    isRoot: () => false,
    executeEnabled: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({
      ...empty(),
      argv,
      ...(run ? await run(argv) : {}),
    }),
  } as HostExecutor;
}

const endpoint = { host: '203.0.113.9', port: 22, user: 'root' };
const jobId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('temp-key depth', () => {
  beforeEach(() => {
    runSshMock.mockReset();
  });

  it('installTempKey rejects non-ssh public key', async () => {
    const r = await installTempKeyOnTarget({
      host: mockHost(),
      endpoint,
      password: 'x',
      publicKey: 'not-a-key',
    });
    expect(r.ok).toBe(false);
    expect(runSshMock).not.toHaveBeenCalled();
  });

  it('installTempKey success when YSK_KEY_INSTALLED in stdout', async () => {
    runSshMock.mockResolvedValue({
      ok: true,
      apply_status: 'applied',
      notes: [],
      stdout: 'YSK_KEY_INSTALLED\n',
      stderr: '',
    });
    const r = await installTempKeyOnTarget({
      host: mockHost(),
      endpoint,
      password: 'secret',
      publicKey: 'ssh-ed25519 AAAA test@host',
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('applied');
    expect(runSshMock).toHaveBeenCalled();
  });

  it('installTempKey succeeds when marker only in stderr', async () => {
    runSshMock.mockResolvedValue({
      ok: true,
      apply_status: 'applied',
      notes: [],
      stdout: '',
      stderr: 'YSK_KEY_INSTALLED',
    });
    const r = await installTempKeyOnTarget({
      host: mockHost(),
      endpoint,
      password: 'p',
      publicKey: 'ssh-ed25519 CCC',
    });
    expect(r.ok).toBe(true);
  });

  it('installTempKey fails when marker missing', async () => {
    runSshMock.mockResolvedValue({
      ok: true,
      apply_status: 'applied',
      notes: [],
      stdout: 'nope',
      stderr: '',
    });
    const r = await installTempKeyOnTarget({
      host: mockHost(),
      endpoint,
      password: 'p',
      publicKey: 'ssh-ed25519 BBBB',
    });
    expect(r.ok).toBe(false);
  });

  it('installTempKey propagates ssh failure', async () => {
    runSshMock.mockResolvedValue({
      ok: false,
      apply_status: 'failed',
      notes: ['ssh failed'],
      stdout: '',
      stderr: 'Connection refused',
    });
    const r = await installTempKeyOnTarget({
      host: mockHost(),
      endpoint,
      password: 'p',
      publicKey: 'ssh-ed25519 DDDD',
    });
    expect(r.ok).toBe(false);
  });

  it('bootstrapTempKeyAuth generates and installs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tk-d-'));
    try {
      runSshMock.mockResolvedValue({
        ok: true,
        apply_status: 'applied',
        notes: ['installed'],
        stdout: 'YSK_KEY_INSTALLED',
        stderr: '',
      });
      const boot = await bootstrapTempKeyAuth({
        host: mockHost(),
        dataDir: dir,
        jobId: 'bbbbbbbb-1111-2222-3333-444444444444',
        endpoint,
        password: 'pw',
      });
      if (!boot.ok && !runSshMock.mock.calls.length) {
        // keygen unavailable
        expect(boot.notes.join(' ')).toMatch(/ssh|key|fail|無法/i);
        return;
      }
      expect(boot.ok).toBe(true);
      expect(boot.auth?.kind).toBe('identity');
      expect(boot.privateKeyPath).toBeTruthy();

      // install fail path
      runSshMock.mockResolvedValue({
        ok: false,
        apply_status: 'failed',
        notes: ['denied'],
        stdout: '',
        stderr: '',
      });
      const failBoot = await bootstrapTempKeyAuth({
        host: mockHost(),
        dataDir: dir,
        jobId: 'cccccccc-1111-2222-3333-444444444444',
        endpoint,
        password: 'pw',
      });
      expect(failBoot.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('destroyLocalTempKey missing is ok; revoke calls ssh', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tk-d2-'));
    try {
      const miss = destroyLocalTempKey(dir, 'no-such-job');
      expect(miss.ok).toBe(true);

      const gen = createMigrateTempKey({ dataDir: dir, jobId });
      if (gen.ok) {
        runSshMock.mockResolvedValue({
          ok: true,
          apply_status: 'applied',
          notes: [],
          stdout: 'YSK_KEY_REVOKED',
          stderr: '',
        });
        const rev = await revokeTempKeyOnTarget({
          host: mockHost(),
          endpoint,
          auth: { kind: 'identity', privateKeyPath: gen.privateKeyPath },
          publicKey: gen.publicKey,
        });
        expect(rev.ok).toBe(true);
        expect(runSshMock).toHaveBeenCalled();
        destroyLocalTempKey(dir, jobId);
        expect(existsSync(join(dir, 'migrate', jobId, 'ssh'))).toBe(false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readTempPublicKey null when missing', () => {
    expect(readTempPublicKey('/tmp/ysk-nope-xyz', 'j')).toBeNull();
  });
});
