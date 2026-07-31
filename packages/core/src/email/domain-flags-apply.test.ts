import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  rebuildSuspendDomainMap,
  writeMailboxVacationCopies,
  applyDomainFlagsToSystem,
  applySuspendMapToPostfix,
  applyVacationSieveToSystem,
} from './domain-flags-apply.js';
import type { HostExecutor } from '../host/executor.js';

function host(opts: {
  execute?: boolean;
  root?: boolean;
  failStep?: string | number;
  exit?: number;
}): HostExecutor {
  let n = 0;
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
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
    runCommand: async (argv) => {
      n += 1;
      const joined = argv.join(' ');
      let exitCode = opts.exit ?? 0;
      if (typeof opts.failStep === 'number' && n === opts.failStep) exitCode = 1;
      if (typeof opts.failStep === 'string' && joined.includes(opts.failStep))
        exitCode = 1;
      return {
        stdout: exitCode === 0 ? 'ok' : '',
        stderr: exitCode === 0 ? '' : 'fail',
        exitCode,
        argv,
        dryRun: false,
      };
    },
  };
}

describe('domain-flags-apply', () => {
  it('rebuilds suspend map from SUSPENDED.flag and empty map', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-susp-'));
    try {
      mkdirSync(join(dir, 'email', 'a.example'), { recursive: true });
      writeFileSync(join(dir, 'email', 'a.example', 'SUSPENDED.flag'), 'x\n', 'utf8');
      const map = rebuildSuspendDomainMap(dir);
      expect(map.domains).toContain('a.example');
      expect(existsSync(map.path)).toBe(true);

      const emptyDir = mkdtempSync(join(tmpdir(), 'ysk-susp-e-'));
      try {
        const empty = rebuildSuspendDomainMap(emptyDir);
        expect(empty.domains).toEqual([]);
        expect(existsSync(empty.path)).toBe(true);
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('copies vacation and notes when missing sieve or empty mailboxes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-vac-'));
    try {
      const miss = writeMailboxVacationCopies({
        dataDir: dir,
        domain: 'none.test',
        mailboxes: ['x'],
        enabled: true,
      });
      expect(miss.written).toHaveLength(0);

      const sieve = join(dir, 'email', 'b.test', 'sieve');
      mkdirSync(sieve, { recursive: true });
      writeFileSync(join(sieve, 'vacation.sieve'), 'require ["vacation"];\n', 'utf8');
      const r = writeMailboxVacationCopies({
        dataDir: dir,
        domain: 'b.test',
        mailboxes: ['info', 'sales'],
        enabled: true,
      });
      expect(r.written).toHaveLength(2);
      expect(existsSync(join(dir, 'email', 'sieve', 'info@b.test', 'vacation.sieve'))).toBe(
        true,
      );
      const off = writeMailboxVacationCopies({
        dataDir: dir,
        domain: 'b.test',
        mailboxes: ['info'],
        enabled: false,
      });
      expect(off.written[0]).toContain('vacation.disabled.sieve');
      const emptyMb = writeMailboxVacationCopies({
        dataDir: dir,
        domain: 'b.test',
        mailboxes: [],
        enabled: true,
      });
      expect(emptyMb.notes.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks system apply without EXECUTE or root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sys-'));
    try {
      const r = await applyDomainFlagsToSystem({
        host: host({ execute: false }),
        dataDir: dir,
        domain: 'c.test',
        mailboxes: [],
        suspended: true,
        vacationEnabled: false,
        applySuspend: true,
        applyVacation: false,
      });
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.apply_status).toBe('blocked');

      const noRoot = await applyDomainFlagsToSystem({
        host: host({ execute: true, root: false }),
        dataDir: dir,
        domain: 'c.test',
        mailboxes: [],
        suspended: true,
        vacationEnabled: false,
      });
      expect(noRoot.blocked).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applySuspendMapToPostfix success and hard fail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-post-'));
    try {
      const map = rebuildSuspendDomainMap(dir);
      const ok = await applySuspendMapToPostfix({
        host: host({ execute: true }),
        mapPath: map.path,
      });
      expect(ok.ok).toBe(true);
      expect(ok.commandResults.length).toBe(5);

      const fail = await applySuspendMapToPostfix({
        host: host({ execute: true, failStep: 2 }),
        mapPath: map.path,
      });
      expect(fail.ok).toBe(false);
      expect(fail.commandResults.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applyVacationSieveToSystem: missing, empty, enable/disable, mixed fail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sieve-sys-'));
    try {
      const miss = await applyVacationSieveToSystem({
        host: host({ execute: true }),
        dataDir: dir,
        domain: 'd.test',
        mailboxes: ['a'],
        enabled: true,
      });
      expect(miss.ok).toBe(false);

      const sieve = join(dir, 'email', 'd.test', 'sieve');
      mkdirSync(sieve, { recursive: true });
      writeFileSync(join(sieve, 'vacation.sieve'), 'require ["vacation"];\n', 'utf8');
      // mailbox under dataDir so parent exists path is chosen
      mkdirSync(join(dir, 'email', 'd.test', 'mailboxes', 'a'), { recursive: true });

      const empty = await applyVacationSieveToSystem({
        host: host({ execute: true }),
        dataDir: dir,
        domain: 'd.test',
        mailboxes: [],
        enabled: true,
      });
      expect(empty.ok).toBe(true);

      const en = await applyVacationSieveToSystem({
        host: host({ execute: true }),
        dataDir: dir,
        domain: 'd.test',
        mailboxes: ['a'],
        enabled: true,
      });
      expect(en.ok).toBe(true);
      expect(en.written.length).toBe(1);

      const dis = await applyVacationSieveToSystem({
        host: host({ execute: true }),
        dataDir: dir,
        domain: 'd.test',
        mailboxes: ['a'],
        enabled: false,
      });
      expect(dis.ok).toBe(true);

      // fail only the reload (2nd command after mailbox script)
      const failReload = await applyVacationSieveToSystem({
        host: host({ execute: true, failStep: 2 }),
        dataDir: dir,
        domain: 'd.test',
        mailboxes: ['a'],
        enabled: true,
      });
      // file write ok, reload soft-fail still ok if anyOk && !anyFail
      expect(failReload.written.length).toBe(1);
      expect(failReload.ok).toBe(true);

      const failWrite = await applyVacationSieveToSystem({
        host: host({ execute: true, exit: 1 }),
        dataDir: dir,
        domain: 'd.test',
        mailboxes: ['a'],
        enabled: true,
      });
      expect(failWrite.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applyDomainFlagsToSystem applied / partial / written paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-flags-full-'));
    try {
      const sieve = join(dir, 'email', 'e.test', 'sieve');
      mkdirSync(sieve, { recursive: true });
      writeFileSync(join(sieve, 'vacation.sieve'), 'require ["vacation"];\n', 'utf8');
      mkdirSync(join(dir, 'email', 'e.test', 'mailboxes', 'info'), { recursive: true });

      const applied = await applyDomainFlagsToSystem({
        host: host({ execute: true, root: true }),
        dataDir: dir,
        domain: 'e.test',
        mailboxes: ['info'],
        suspended: true,
        vacationEnabled: true,
      });
      expect(applied.ok).toBe(true);
      expect(applied.apply_status).toBe('applied');
      expect(applied.written.length).toBeGreaterThan(0);

      const partial = await applyDomainFlagsToSystem({
        host: host({ execute: true, root: true, failStep: 'postmap' }),
        dataDir: dir,
        domain: 'e.test',
        mailboxes: ['info'],
        suspended: true,
        vacationEnabled: false,
        applyVacation: false,
      });
      expect(partial.ok).toBe(false);
      expect(partial.apply_status).toBe('partial');

      // suspend only skipped, vacation with no mailboxes → may be written
      const written = await applyDomainFlagsToSystem({
        host: host({ execute: true, root: true }),
        dataDir: dir,
        domain: 'e.test',
        mailboxes: [],
        suspended: false,
        vacationEnabled: true,
        applySuspend: false,
        applyVacation: true,
      });
      // vacation empty mailboxes returns ok without didWork from vac.ok path
      expect(['written', 'applied']).toContain(written.apply_status);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
