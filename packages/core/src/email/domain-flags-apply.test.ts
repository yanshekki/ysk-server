import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  rebuildSuspendDomainMap,
  writeMailboxVacationCopies,
  applyDomainFlagsToSystem,
} from './domain-flags-apply.js';
import type { HostExecutor } from '../host/executor.js';

function host(execute: boolean, root = true): HostExecutor {
  return {
    executeEnabled: () => execute,
    isRoot: () => root,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
  };
}

describe('domain-flags-apply', () => {
  it('rebuilds suspend map from SUSPENDED.flag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-susp-'));
    try {
      mkdirSync(join(dir, 'email', 'a.example'), { recursive: true });
      writeFileSync(join(dir, 'email', 'a.example', 'SUSPENDED.flag'), 'x\n', 'utf8');
      const map = rebuildSuspendDomainMap(dir);
      expect(map.domains).toContain('a.example');
      expect(existsSync(map.path)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('copies vacation to mailbox sieve dirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-vac-'));
    try {
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks system apply without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sys-'));
    try {
      const r = await applyDomainFlagsToSystem({
        host: host(false),
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
