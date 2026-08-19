import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  clearValidatorInstance,
  createValidatorInstance,
  isClearConfirm,
  removeValidatorInstance,
  startValidatorInstance,
} from './manager.js';
import { getValidatorInstance } from './store.js';

function mockHost(opts: {
  execute?: boolean;
  dfAvail?: number;
  docker?: boolean;
  composeFail?: boolean;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => true,
    runCommand: async (argv, runOpts) => {
      const r = (stdout: string, exitCode = 0): RunResult => ({
        stdout,
        stderr: exitCode ? 'err' : '',
        exitCode,
        argv,
        dryRun: Boolean(runOpts?.dryRun),
      });
      if (argv[0] === 'df') {
        const avail = opts.dfAvail ?? 2_000_000_000_000;
        return r(
          [
            'Filesystem Type 1B-blocks Used Available Use% Mounted on',
            `/dev/sda1 ext4 3000000000000 1000000000000 ${avail} 10% /`,
          ].join('\n'),
        );
      }
      if (argv[0] === 'du') return r('1\t/x');
      if (argv[0] === 'docker' && argv[1] === 'compose' && argv[2] === 'version') {
        return opts.docker === false ? r('', 1) : r('Docker Compose version v2.29.0');
      }
      if (argv[0] === 'docker' && argv.includes('up')) {
        return opts.composeFail ? r('', 1) : r('started');
      }
      if (argv[0] === 'docker' && argv.includes('ps')) {
        return r('{"State":"running"}');
      }
      if (argv[0] === 'docker') return r('ok');
      return r('');
    },
  } as HostExecutor;
}

describe('validator manager', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'ysk-val-mgr-'));
    dirs.push(d);
    return d;
  }

  it('honours safe dataPath and rpcPort; rejects system paths', async () => {
    const dataDir = tmp();
    const host = mockHost({ execute: false });
    const bad = await createValidatorInstance({
      dataDir,
      host,
      execute: false,
      chain: 'eth',
      network: 'hoodi',
      profile: 'minimal',
      dataPath: '/etc/passwd',
    });
    expect(bad.blocked).toBe(true);

    const dataPath = join(dataDir, 'chain-data');
    const ok = await createValidatorInstance({
      dataDir,
      host,
      execute: false,
      chain: 'eth',
      network: 'hoodi',
      profile: 'minimal',
      dataPath,
      rpcPort: 18545,
    });
    expect(ok.ok).toBe(true);
    const inst = getValidatorInstance(dataDir, 'eth-hoodi-1');
    expect(inst?.dataPath).toBe(dataPath);
    expect(inst?.ports.rpc).toBe(18545);
  });

  it('create dry-run writes spec without claiming applied', async () => {
    const dataDir = tmp();
    const r = await createValidatorInstance({
      dataDir,
      host: mockHost({ execute: false }),
      execute: false,
      chain: 'eth',
      network: 'hoodi',
      profile: 'minimal',
    });
    expect(r.ok).toBe(true);
    expect(r.blocked).not.toBe(true);
    expect(r.apply_status).toBe('written');
    expect(r.instanceId).toBe('eth-hoodi-1');
    expect(getValidatorInstance(dataDir, 'eth-hoodi-1')?.desiredState).toBe('stopped');
  });

  it('create execute applies when docker compose works', async () => {
    const dataDir = tmp();
    const r = await createValidatorInstance({
      dataDir,
      host: mockHost({ execute: true, docker: true }),
      execute: true,
      chain: 'eth',
      network: 'hoodi',
      profile: 'minimal',
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('applied');
    expect(getValidatorInstance(dataDir, 'eth-hoodi-1')?.desiredState).toBe('running');
  });

  it('create execute without docker is blocked', async () => {
    const dataDir = tmp();
    const r = await createValidatorInstance({
      dataDir,
      host: mockHost({ execute: true, docker: false }),
      execute: true,
      chain: 'avax',
      network: 'fuji',
      profile: 'minimal',
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.apply_status).toBe('blocked');
    expect(getValidatorInstance(dataDir, 'avax-fuji-1')).toBeTruthy();
  });

  it('refuses mainnet when free space is below minimum', async () => {
    const dataDir = tmp();
    const r = await createValidatorInstance({
      dataDir,
      host: mockHost({ execute: true, dfAvail: 10_000 }),
      execute: true,
      chain: 'eth',
      network: 'mainnet',
      profile: 'minimal',
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('allows mainnet below minimum when operator accepts low disk', async () => {
    const dataDir = tmp();
    const r = await createValidatorInstance({
      dataDir,
      host: mockHost({ execute: false, dfAvail: 10_000 }),
      execute: false,
      chain: 'eth',
      network: 'mainnet',
      profile: 'minimal',
      acceptLowDisk: true,
    });
    expect(r.blocked).not.toBe(true);
    expect(r.instanceId).toBe('eth-mainnet-1');
  });

  it('start without execute is blocked; clear needs confirm', async () => {
    const dataDir = tmp();
    await createValidatorInstance({
      dataDir,
      host: mockHost({ execute: false }),
      execute: false,
      chain: 'eth',
      network: 'hoodi',
      profile: 'minimal',
    });
    const start = await startValidatorInstance({
      dataDir,
      host: mockHost({ execute: false }),
      execute: false,
      id: 'eth-hoodi-1',
    });
    expect(start.ok).toBe(false);
    expect(start.blocked).toBe(true);

    const noConfirm = await clearValidatorInstance({
      dataDir,
      host: mockHost({ execute: true }),
      execute: true,
      id: 'eth-hoodi-1',
      confirm: 'nope',
    });
    expect(noConfirm.ok).toBe(false);

    const cleared = await clearValidatorInstance({
      dataDir,
      host: mockHost({ execute: true }),
      execute: true,
      id: 'eth-hoodi-1',
      confirm: 'CLEAR',
    });
    expect(cleared.ok).toBe(true);
    expect(cleared.apply_status).toBe('applied');

    const removed = await removeValidatorInstance({
      dataDir,
      host: mockHost({ execute: true }),
      execute: true,
      id: 'eth-hoodi-1',
      confirm: 'eth-hoodi-1',
    });
    expect(removed.ok).toBe(true);
    expect(getValidatorInstance(dataDir, 'eth-hoodi-1')).toBeUndefined();
  });

  it('isClearConfirm accepts id or CLEAR', () => {
    expect(isClearConfirm('eth-hoodi-1', 'eth-hoodi-1')).toBe(true);
    expect(isClearConfirm('eth-hoodi-1', 'CLEAR')).toBe(true);
    expect(isClearConfirm('eth-hoodi-1', 'clear')).toBe(true);
    expect(isClearConfirm('eth-hoodi-1', 'x')).toBe(false);
  });
});
