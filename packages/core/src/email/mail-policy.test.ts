import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyMailDomainPolicy,
  computeGlobalMessageRatePerHour,
  rebuildAggregatePolicyMaps,
} from './mail-policy.js';
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

describe('mail-policy', () => {
  it('writes policy maps and computes global rate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mpol-'));
    try {
      const r = await applyMailDomainPolicy({
        dataDir: dir,
        host: host(false),
        domain: 'Example.COM',
        rateLimitPerHour: 100,
        antispam: true,
        applySystem: false,
      });
      expect(r.ok).toBe(true);
      expect(r.apply_status).toBe('written');
      expect(existsSync(join(dir, 'email', 'policy', 'example.com', 'rate.cf'))).toBe(true);

      await applyMailDomainPolicy({
        dataDir: dir,
        host: host(false),
        domain: 'b.test',
        rateLimitPerHour: 50,
        antispam: false,
      });
      expect(computeGlobalMessageRatePerHour(dir)).toBe(50);
      const agg = rebuildAggregatePolicyMaps(dir);
      expect(agg.written.length).toBeGreaterThan(0);

      const blocked = await applyMailDomainPolicy({
        dataDir: dir,
        host: host(false),
        domain: 'c.test',
        rateLimitPerHour: 10,
        applySystem: true,
      });
      expect(blocked.blocked).toBe(true);
      expect(blocked.ok).toBe(false);
      expect(blocked.apply_status).toBe('blocked');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults global rate when empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mpol-empty-'));
    try {
      mkdirSync(join(dir, 'email', 'policy'), { recursive: true });
      expect(computeGlobalMessageRatePerHour(dir)).toBe(500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('mail-policy applySystem paths', () => {
  function mockHost(opts?: {
    execute?: boolean;
    root?: boolean;
    fail?: (name: string) => boolean;
    postconfOut?: string;
  }): HostExecutor {
    return {
      executeEnabled: () => opts?.execute !== false,
      isRoot: () => opts?.root !== false,
      pathExists: () => false,
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => undefined,
      deletePath: async () => undefined,
      mkdirp: async () => undefined,
      sysInfo: async () => ({}),
      serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
      runCommand: async (argv) => {
        const joined = argv.join(' ');
        const fail = opts?.fail?.(joined) ?? false;
        if (joined.includes('postconf smtpd_client_message_rate_limit')) {
          return {
            stdout: opts?.postconfOut ?? 'smtpd_client_message_rate_limit = 50\nanvil_rate_time_unit = 3600s',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (joined.includes('systemctl') && joined.includes('reload')) {
          const unit = argv.includes('postfix') ? 'postfix' : 'rspamd';
          if (opts?.fail?.(unit + ' reload')) {
            return { stdout: '', stderr: 'fail', exitCode: 1, argv, dryRun: false };
          }
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (fail) {
          return { stdout: '', stderr: 'mock fail', exitCode: 1, argv, dryRun: false };
        }
        return { stdout: 'ok', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
  }

  it('applySystem happy path writes anvil + rspamd and reports applied/written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mpol-sys-'));
    try {
      // seed two domains so maps exist
      await applyMailDomainPolicy({
        dataDir: dir,
        host: host(false),
        domain: 'a.example',
        rateLimitPerHour: 80,
        antispam: true,
        applySystem: false,
      });
      await applyMailDomainPolicy({
        dataDir: dir,
        host: host(false),
        domain: 'b.example',
        rateLimitPerHour: 40,
        antispam: false,
        applySystem: false,
      });
      const r = await applyMailDomainPolicy({
        dataDir: dir,
        host: mockHost({ execute: true, root: true, postconfOut: 'smtpd_client_message_rate_limit = 40' }),
        domain: 'a.example',
        rateLimitPerHour: 80,
        antispam: true,
        applySystem: true,
      });
      expect(r.written.some((p) => p.includes('ysk-anvil.env') || p.includes('ysk-ratelimit'))).toBe(true);
      expect(['applied', 'written']).toContain(r.apply_status);
      expect(r.notes.length).toBeGreaterThan(5);
      expect(existsSync(join(dir, 'email', 'policy', 'ysk-ratelimit.conf'))).toBe(true);
      expect(existsSync(join(dir, 'email', 'policy', 'ysk-anvil.env'))).toBe(true);
      expect(computeGlobalMessageRatePerHour(dir)).toBe(40);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applySystem blocked when not root even if execute on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mpol-nr-'));
    try {
      const r = await applyMailDomainPolicy({
        dataDir: dir,
        host: mockHost({ execute: true, root: false }),
        domain: 'x.test',
        rateLimitPerHour: 20,
        applySystem: true,
      });
      expect(r.blocked).toBe(true);
      expect(r.apply_status).toBe('blocked');
      expect(r.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applySystem hardFail on mkdir and unverified postconf', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mpol-hf-'));
    try {
      await applyMailDomainPolicy({
        dataDir: dir,
        host: host(false),
        domain: 'h.test',
        rateLimitPerHour: 15,
        antispam: true,
      });
      const r = await applyMailDomainPolicy({
        dataDir: dir,
        host: mockHost({
          execute: true,
          root: true,
          postconfOut: 'something else',
          fail: (j) => j.includes('mkdir policy') || j.includes('postfix reload'),
        }),
        domain: 'h.test',
        rateLimitPerHour: 15,
        antispam: true,
        applySystem: true,
      });
      // hardFail path → not applied
      expect(r.apply_status).toBe('written');
      expect(r.ok).toBe(false);
      expect(r.notes.some((n) => /fail|failed|mkdir|verify|rate/i.test(n) || n.length > 0)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('unlimited rate writes comment-only rate.cf; rebuild handles empty spam', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mpol-unl-'));
    try {
      const r = await applyMailDomainPolicy({
        dataDir: dir,
        host: host(false),
        domain: 'free.test',
        rateLimitPerHour: null,
        antispam: false,
      });
      expect(r.ok).toBe(true);
      const rate = join(dir, 'email', 'policy', 'free.test', 'rate.cf');
      expect(existsSync(rate)).toBe(true);
      // no positive rates → default 500
      expect(computeGlobalMessageRatePerHour(dir)).toBe(500);
      const agg = rebuildAggregatePolicyMaps(dir);
      expect(agg.written.length).toBe(3);
      // rate 0 / negative treated as unlimited
      await applyMailDomainPolicy({
        dataDir: dir,
        host: host(false),
        domain: 'z.test',
        rateLimitPerHour: 0,
        antispam: true,
      });
      expect(computeGlobalMessageRatePerHour(dir)).toBe(500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('computeGlobalMessageRatePerHour clamps extremes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mpol-clamp-'));
    try {
      mkdirSync(join(dir, 'email', 'policy', 'tiny'), { recursive: true });
      writeFileSync(join(dir, 'email', 'policy', 'tiny', 'rate.cf'), 'tiny 5\n', 'utf8');
      expect(computeGlobalMessageRatePerHour(dir)).toBe(10); // floor clamp
      writeFileSync(join(dir, 'email', 'policy', 'tiny', 'rate.cf'), 'tiny 999999\n', 'utf8');
      expect(computeGlobalMessageRatePerHour(dir)).toBe(50_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
