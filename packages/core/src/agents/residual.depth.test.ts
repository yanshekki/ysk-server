import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { applyAgentInstall, markAgentManaged } from './install.js';
import {
  agentCycle,
  isCommandFailure,
  runOutboundAgent,
} from './outbound-agent.js';
import {
  probeAllAgentRuntimes,
  probeAgentRuntime,
  renderAgentSystemdUnit,
  resolveAgentBinary,
} from './probe.js';

function mockHost(opts: {
  execute?: boolean;
  root?: boolean;
  paths?: Record<string, boolean>;
  onRun?: (argv: string[]) => Partial<RunResult> | void;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
    pathExists: (p) => Boolean(opts.paths?.[p]),
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
      const partial = opts.onRun?.(argv) ?? {};
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
        ...partial,
      };
    },
  };
}

describe('agents residual depth', () => {
  it('applyAgentInstall executes commands and enables unit as root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-agent-res-'));
    try {
      const runs: string[][] = [];
      const host = mockHost({
        execute: true,
        root: true,
        paths: { '/bin/systemctl': true },
        onRun: (argv) => {
          runs.push(argv);
          const joined = argv.join(' ');
          if (joined.includes('command -v')) {
            return { stdout: '/usr/bin/openclaw\n' };
          }
          if (argv[0] === 'systemctl' && argv[1] === 'is-active') {
            return { stdout: 'inactive\n' };
          }
          return { exitCode: 0 };
        },
      });
      const r = await applyAgentInstall({
        dataDir: dir,
        kind: 'openclaw',
        host,
        execute: true,
        enableUnit: true,
      });
      expect(r.ok).toBe(true);
      expect(r.binaryPath).toBe('/usr/bin/openclaw');
      expect(r.enabled).toBe(true);
      expect(r.commandResults.length).toBeGreaterThan(0);
      expect(runs.some((a) => a[0] === 'cp')).toBe(true);
      expect(runs.some((a) => a.includes('daemon-reload'))).toBe(true);
      expect(existsSync(join(dir, 'systemd', 'ysk-agent-openclaw.service'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applyAgentInstall notes non-root and mkdir failure paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-agent-res2-'));
    try {
      const host = mockHost({
        execute: true,
        root: false,
        onRun: (argv) => {
          if (argv[0] === 'mkdir') return { exitCode: 1, stderr: 'perm' };
          if (argv.join(' ').includes('command -v')) return { stdout: '' };
          if (argv[0] === 'systemctl') return { stdout: 'unknown' };
          return { exitCode: 1, stderr: 'npm fail' };
        },
      });
      const r = await applyAgentInstall({
        dataDir: dir,
        kind: 'hermes',
        host,
        execute: true,
      });
      expect(r.ok).toBe(false);
      expect(r.requiresRoot).toBe(true);
      expect(r.notes.some((n) => /mkdir|npm|binary|CLI|失敗|fail/i.test(n))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('markAgentManaged writes once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-agent-mark-'));
    try {
      const m1 = markAgentManaged(dir, 'ionclaw');
      expect(existsSync(m1)).toBe(true);
      const body = readFileSync(m1, 'utf8');
      const m2 = markAgentManaged(dir, 'ionclaw');
      expect(m2).toBe(m1);
      expect(readFileSync(m2, 'utf8')).toBe(body);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probeAll + resolve binary + active unit without binary honesty', async () => {
    const host = mockHost({
      paths: {
        '/opt/ysk-server/agents/openclaw': true,
        '/bin/systemctl': true,
      },
      onRun: (argv) => {
        if (argv[0] === 'systemctl') return { stdout: 'active\n' };
        if (argv.join(' ').includes('command -v')) return { stdout: '' };
        return {};
      },
    });
    const all = await probeAllAgentRuntimes(host);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const open = all.find((a) => a.kind === 'openclaw');
    expect(open?.status).toBe('running');
    expect(open?.notes.some((n) => /placeholder|binary|CLI|誠實|refuse/i.test(n) || n.length > 0)).toBe(
      true,
    );

    const bin = await resolveAgentBinary('hermes', mockHost({
      onRun: () => ({ stdout: '/usr/local/bin/hermes\n' }),
    }));
    expect(bin).toBe('/usr/local/bin/hermes');

    const noSys = await probeAgentRuntime(
      'ionclaw',
      mockHost({ paths: {}, onRun: () => ({ stdout: '' }) }),
    );
    expect(noSys.notes.length).toBeGreaterThan(0);
    expect(noSys.status).toBe('not_installed');
  });

  it('renderAgentSystemdUnit with binaryArgs', () => {
    const u = renderAgentSystemdUnit({
      kind: 'openclaw',
      installPath: '/opt/x',
      binaryPath: '/usr/bin/openclaw',
      binaryArgs: ['--serve', '0.0.0.0'],
      user: 'ysk',
    });
    expect(u).toContain('User=ysk');
    expect(u).toContain('/usr/bin/openclaw');
    expect(u).toContain('--serve');
  });

  it('outbound: default handler, catch, heartbeat/pull failures, sleep abort', async () => {
    expect(isCommandFailure(null)).toBe(false);
    expect(isCommandFailure({ error: 'boom' })).toBe(true);
    expect(isCommandFailure({ error: 'x', ok: true })).toBe(false);

    const fetchFailHb = vi.fn(async (url: string) => {
      if (String(url).endsWith('/register')) {
        return {
          ok: true,
          json: async () => ({ id: 's1', token: 'ysk_agent_testtoken_s1' }),
        } as Response;
      }
      return { ok: false, status: 503 } as Response;
    });
    await expect(
      agentCycle({
        controlPlane: 'http://cp/',
        agentId: 'a',
        fetchImpl: fetchFailHb as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/heartbeat/);

    const fetchFailPull = vi.fn(async (url: string) => {
      if (String(url).endsWith('/register')) {
        return {
          ok: true,
          json: async () => ({ id: 's2', token: 'ysk_agent_testtoken_s2' }),
        } as Response;
      }
      if (String(url).includes('/heartbeat')) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      return { ok: false, status: 502 } as Response;
    });
    await expect(
      agentCycle({
        controlPlane: 'http://cp',
        agentId: 'a',
        sessionId: 'existing',
        fetchImpl: fetchFailPull as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/pull/);

    const fetchDefault = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/register')) {
        return { ok: true, json: async () => ({ id: 's3', token: 'ysk_agent_testtoken_s3' }) } as Response;
      }
      if (String(url).includes('/heartbeat')) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (String(url).includes('/commands') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: 'c1', payload: { x: 1 } },
              { id: 'c2', payload: { y: 2 } },
            ],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    const r = await agentCycle({
      controlPlane: 'http://cp.local',
      agentId: 'edge',
      fetchImpl: fetchDefault as unknown as typeof fetch,
      // no onCommand → default refuse silent success
    });
    expect(r.commandsHandled).toBe(2);
    const acks = fetchDefault.mock.calls.filter((c) => String(c[0]).includes('/ack'));
    expect(acks.length).toBe(2);
    const body = JSON.parse(String((acks[0]?.[1] as RequestInit)?.body ?? '{}')) as {
      error?: boolean;
    };
    expect(body.error).toBe(true);

    const fetchThrow = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/register')) {
        return { ok: true, json: async () => ({ id: 's4', token: 'ysk_agent_testtoken_s4' }) } as Response;
      }
      if (String(url).includes('/heartbeat')) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (String(url).includes('/commands') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({ items: [{ id: 'cx', payload: {} }] }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    await agentCycle({
      controlPlane: 'http://cp',
      agentId: 'e',
      fetchImpl: fetchThrow as unknown as typeof fetch,
      onCommand: async () => {
        throw new Error('handler boom');
      },
    });
    const ack = fetchThrow.mock.calls.find((c) => String(c[0]).includes('/ack'));
    const ab = JSON.parse(String((ack?.[1] as RequestInit)?.body ?? '{}')) as {
      error?: boolean;
      result?: { error?: string };
    };
    expect(ab.error).toBe(true);
    expect(ab.result?.error).toMatch(/handler boom/);

    // runOutboundAgent reconnects after cycle error, then aborts mid-sleep
    const ac = new AbortController();
    let n = 0;
    const fetchLoop = vi.fn(async (url: string) => {
      n += 1;
      if (n === 1) return { ok: false, status: 500 } as Response; // register fail → catch
      if (n >= 3) {
        queueMicrotask(() => ac.abort());
      }
      if (String(url).endsWith('/register')) {
        return { ok: true, json: async () => ({ id: 'loop', token: 'ysk_agent_testtoken_loop' }) } as Response;
      }
      if (String(url).includes('/heartbeat')) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => ({ items: [] }) } as Response;
    });
    await runOutboundAgent({
      controlPlane: 'http://cp',
      agentId: 'loop',
      intervalMs: 20,
      signal: ac.signal,
      fetchImpl: fetchLoop as unknown as typeof fetch,
    });
    expect(fetchLoop.mock.calls.length).toBeGreaterThan(0);

    // already aborted signal resolves sleep immediately
    const ac2 = new AbortController();
    ac2.abort();
    await runOutboundAgent({
      controlPlane: 'http://cp',
      agentId: 'done',
      intervalMs: 50,
      signal: ac2.signal,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
  });
});
