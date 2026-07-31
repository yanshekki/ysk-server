import { describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  setCloudflareSecurityLevel,
  enableCloudflareUnderAttack,
  disableCloudflareUnderAttack,
} from './cloudflare-ua.js';
import {
  renderCfOnlyUfwScript,
  writeAndMaybeApplyCfOnlyUfw,
  CLOUDFLARE_IPV4_RANGES,
  CLOUDFLARE_IPV6_RANGES,
} from './cf-ufw.js';
import {
  parseAuthFailIps,
  collectTopIps,
  listVhostDefenseMarkers,
} from './intel.js';
import {
  scoreToThreatLevel,
  threatThresholdsFromAutoPreset,
  collectDefenseSignals,
  DEFAULT_SIGNAL_WEIGHTS,
} from './signals.js';
import {
  sanitizeRate,
  injectDefenseLimitsIntoConf,
  injectDefenseLimitsIntoManagedVhosts,
  writeDefenseNginxLimits,
  readActiveNginxLimitNotes,
  renderDefenseNginxConf,
  defenseNginxConfPath,
} from './nginx-limits.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts: {
  execute?: boolean;
  root?: boolean;
  run?: (argv: string[]) => Partial<RunResult> | Promise<Partial<RunResult>>;
}): HostExecutor {
  return {
    pathExists: () => false,
    isRoot: () => opts.root ?? false,
    executeEnabled: () => opts.execute ?? false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      const partial = opts.run ? await opts.run(argv) : {};
      return { ...empty(), argv, ...partial };
    },
  } as HostExecutor;
}

describe('cloudflare-ua depth', () => {
  it('rejects empty zone', async () => {
    const r = await setCloudflareSecurityLevel({ zone: '  ', level: 'high', token: 't' });
    expect(r.ok).toBe(false);
    expect(r.requiresToken).toBe(true);
  });

  it('dryRun with token returns ok without calling API', async () => {
    const r = await setCloudflareSecurityLevel({
      zone: 'Example.COM',
      level: 'under_attack',
      token: 'secret-token',
      dryRun: true,
    });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.zone).toBe('example.com');
  });

  it('resolves zone and patches security_level via fetchImpl', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/zones?name=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: [{ id: 'zid-1', name: 'example.com' }],
          }),
        };
      }
      if (url.includes('/settings/security_level') && (init?.method ?? 'GET') === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: { value: 'medium' } }),
        };
      }
      if (init?.method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, result: { value: 'under_attack' } }),
        };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const r = await setCloudflareSecurityLevel({
      zone: 'example.com',
      level: 'under_attack',
      token: 'tok',
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(r.zoneId).toBe('zid-1');
    expect(r.previousLevel).toBe('medium');
    expect(r.level).toBe('under_attack');
    expect(calls.some((c) => c.startsWith('PATCH'))).toBe(true);
  });

  it('zone resolve failure and PATCH failure are honest', async () => {
    const failZone = await setCloudflareSecurityLevel({
      zone: 'missing.example',
      level: 'high',
      token: 'tok',
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        json: async () => ({
          success: false,
          errors: [{ message: 'zone not found' }],
        }),
      }),
    });
    expect(failZone.ok).toBe(false);
    expect(failZone.errors.join(' ')).toMatch(/zone not found|404|missing/i);

    const failPatch = await setCloudflareSecurityLevel({
      zone: 'example.com',
      level: 'high',
      token: 'tok',
      fetchImpl: async (url, init) => {
        if (url.includes('zones?name=')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, result: [{ id: 'z', name: 'example.com' }] }),
          };
        }
        if (init?.method === 'PATCH') {
          return {
            ok: false,
            status: 403,
            json: async () => ({
              success: false,
              errors: [{ message: 'forbidden' }],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ result: { value: 'low' } }) };
      },
    });
    expect(failPatch.ok).toBe(false);
    expect(failPatch.errors.join(' ')).toMatch(/forbidden|403/i);
  });

  it('enable/disable under attack batch zones', async () => {
    const prev = process.env.CF_API_TOKEN;
    delete process.env.CF_API_TOKEN;
    try {
      const en = await enableCloudflareUnderAttack({
        zones: ['a.com', 'b.com'],
        dryRun: true,
        token: 't',
      });
      expect(en.results).toHaveLength(2);
      expect(en.ok).toBe(true);
      const dis = await disableCloudflareUnderAttack({
        zones: ['a.com'],
        dryRun: true,
        token: 't',
        level: 'medium',
      });
      expect(dis.results[0]?.level).toBe('medium');
    } finally {
      if (prev !== undefined) process.env.CF_API_TOKEN = prev;
    }
  });

  it('fetch throw is caught honestly', async () => {
    const r = await setCloudflareSecurityLevel({
      zone: 'x.com',
      level: 'high',
      token: 't',
      fetchImpl: async () => {
        throw new Error('network boom');
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/network boom/);
  });
});

describe('cf-ufw depth', () => {
  it('renders script with CF ranges and custom keep ports', () => {
    const s = renderCfOnlyUfwScript({ keepTcpPorts: [22, 2222, -1, 70000] });
    expect(s).toContain('#!/usr/bin/env bash');
    expect(s).toContain('ufw allow 22/tcp');
    expect(s).toContain('ufw allow 2222/tcp');
    expect(s).not.toContain('ufw allow -1/tcp');
    expect(s).toContain(CLOUDFLARE_IPV4_RANGES[0]);
    expect(s).toContain(CLOUDFLARE_IPV6_RANGES[0]);
    expect(s).toContain('ysk-cf-443-v6');
  });

  it('write without apply is ok; apply blocks without execute/root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cfufw-'));
    try {
      const dry = await writeAndMaybeApplyCfOnlyUfw({
        dataDir: dir,
        host: mockHost({}),
        apply: false,
      });
      expect(dry.ok).toBe(true);
      expect(existsSync(dry.written[0]!)).toBe(true);

      const noExec = await writeAndMaybeApplyCfOnlyUfw({
        dataDir: dir,
        host: mockHost({ execute: false, root: true }),
        apply: true,
      });
      expect(noExec.ok).toBe(false);
      expect(noExec.blocked).toBe(true);

      const noRoot = await writeAndMaybeApplyCfOnlyUfw({
        dataDir: dir,
        host: mockHost({ execute: true, root: false }),
        apply: true,
      });
      expect(noRoot.ok).toBe(false);
      expect(noRoot.blocked).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('apply with execute+root runs bash script', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cfufw2-'));
    try {
      const cmds: string[][] = [];
      const r = await writeAndMaybeApplyCfOnlyUfw({
        dataDir: dir,
        host: mockHost({
          execute: true,
          root: true,
          run: async (argv) => {
            cmds.push(argv);
            return { exitCode: 0, stdout: 'Status: active' };
          },
        }),
        apply: true,
        keepTcpPorts: [22],
      });
      expect(r.ok).toBe(true);
      expect(cmds.some((a) => a[0] === 'bash')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('intel depth', () => {
  it('parseAuthFailIps handles rhost= and private skip', () => {
    const content = [
      'authentication failure; rhost=203.0.113.50',
      'Failed password for invalid user from 10.0.0.1 port 22',
      'Connection closed by 198.51.100.9 port 22',
      'noise line',
    ].join('\n');
    const m = parseAuthFailIps(content);
    expect(m.get('203.0.113.50')).toBe(1);
    expect(m.has('10.0.0.1')).toBe(false);
    expect(m.get('198.51.100.9')).toBe(1);
  });

  it('collectTopIps merges access + auth and scores', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-intel-d-'));
    try {
      const logDir = join(dir, 'nginx', 'logs');
      mkdirSync(logDir, { recursive: true });
      const lines = Array.from({ length: 60 }, (_, i) =>
        `203.0.113.77 - - [01/Jan/2026:00:00:${String(i).padStart(2, '0')} +0000] "GET /.env HTTP/1.1" 404 12`,
      );
      lines.push(
        `203.0.113.77 - - [01/Jan/2026:00:01:00 +0000] "GET / HTTP/1.1" 429 1`,
      );
      writeFileSync(join(logDir, 'access.log'), lines.join('\n'));
      writeFileSync(
        join(logDir, 'access.extra.log'),
        'Failed password for root from 203.0.113.77 port 22\n'.repeat(10),
      );
      const top = collectTopIps(dir, 5);
      expect(top.items.length).toBeGreaterThan(0);
      const row = top.items.find((i) => i.ip === '203.0.113.77');
      expect(row).toBeTruthy();
      expect(row!.score).toBeGreaterThan(0);
      expect(top.notes.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('listVhostDefenseMarkers skips zone file and empty dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-vhost-m-'));
    try {
      expect(listVhostDefenseMarkers(dir).total).toBe(0);
      const conf = join(dir, 'nginx', 'conf.d');
      mkdirSync(conf, { recursive: true });
      writeFileSync(join(conf, '00-ysk-defense.conf'), 'zone');
      writeFileSync(join(conf, 'a.conf'), 'server { }\n');
      writeFileSync(
        join(conf, 'b.conf'),
        'server {\n# BEGIN YSK_DEFENSE\nx\n# END YSK_DEFENSE\n}\n',
      );
      const v = listVhostDefenseMarkers(dir);
      expect(v.total).toBe(2);
      expect(v.withLimit).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('signals depth', () => {
  it('threatThresholdsFromAutoPreset orders critical above underAttack', () => {
    const t = threatThresholdsFromAutoPreset({
      escalateToHardenedAt: 20,
      escalateToUnderAttackAt: 50,
      suggestEmergencyAt: 80,
      criticalAt: 40,
    });
    expect(t.elevatedAt).toBe(20);
    expect(t.underAttackAt).toBe(50);
    expect(t.criticalAt).toBeGreaterThanOrEqual(t.underAttackAt);
    expect(scoreToThreatLevel(55, t)).toBe('under_attack');
  });

  it('collectDefenseSignals weights and high rate', async () => {
    const host = mockHost({
      execute: false,
      run: async (argv) => {
        const j = argv.join(' ');
        if (j.includes('ufw') || j.includes('firewall')) {
          return { stdout: 'Status: inactive', exitCode: 0 };
        }
        if (j.includes('fail2ban') || j.includes('f2b')) {
          return { stdout: 'Status\nNumber of jail: 0', exitCode: 0 };
        }
        return { exitCode: 0, stdout: '' };
      },
    });
    const r = await collectDefenseSignals({
      host,
      requestCountLastMinute: 2000,
      weights: { ...DEFAULT_SIGNAL_WEIGHTS, highReqRate: 2 },
      threatThresholds: { elevatedAt: 5, underAttackAt: 40, criticalAt: 90 },
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.signals.some((s) => s.id === 'req_rate')).toBe(true);
    expect(['low', 'elevated', 'under_attack', 'critical']).toContain(r.threatLevel);
    expect(Array.isArray(r.bans)).toBe(true);
  }, 20_000);

  it('scoreToThreatLevel edge clamping', () => {
    // elevatedAt clamped to ≥1; score 0 stays low
    expect(scoreToThreatLevel(0, { elevatedAt: 0, underAttackAt: 0, criticalAt: 0 })).toBe('low');
    // underAttack/critical reordered so elevated ≤ underAttack ≤ critical (all become 50)
    expect(scoreToThreatLevel(55, { elevatedAt: 50, underAttackAt: 40, criticalAt: 30 })).toBe(
      'critical',
    );
    expect(scoreToThreatLevel(25, { elevatedAt: 20, underAttackAt: 80, criticalAt: 90 })).toBe(
      'elevated',
    );
    expect(scoreToThreatLevel(99)).toBe('critical');
  });
});

describe('nginx-limits depth', () => {
  it('sanitizeRate and inject without server_name', () => {
    expect(sanitizeRate('10r/s!!!')).toBe('10r/s');
    expect(sanitizeRate('@@@')).toBe('10r/s');
    const conf = renderDefenseNginxConf({ reqRate: '5r/s', burst: 10, connLimit: 20 });
    expect(conf).toContain('rate=5r/s');
    const noServer = injectDefenseLimitsIntoConf('upstream x { server 1; }\n');
    expect(noServer).toBe('upstream x { server 1; }\n');
    const withServer = injectDefenseLimitsIntoConf('server {\n  listen 80;\n}\n');
    expect(withServer).toContain('BEGIN YSK_DEFENSE');
    const replace = injectDefenseLimitsIntoConf(withServer);
    expect(replace.match(/BEGIN YSK_DEFENSE/g)?.length).toBe(1);
  });

  it('inject managed vhosts and readActive notes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-d-'));
    try {
      expect(readActiveNginxLimitNotes(dir).exists).toBe(false);
      const empty = injectDefenseLimitsIntoManagedVhosts(dir, {
        reqRate: '1r/s',
        burst: 1,
        connLimit: 1,
      });
      expect(empty.updated).toHaveLength(0);

      const confDir = join(dir, 'nginx', 'conf.d');
      mkdirSync(confDir, { recursive: true });
      writeFileSync(join(confDir, 'plain.conf'), 'not a server file\n');
      writeFileSync(
        join(confDir, 'site.conf'),
        'server {\n  server_name x.test;\n  location / { return 200; }\n}\n',
      );
      const w = writeDefenseNginxLimits(dir, {
        reqRate: '8r/s',
        burst: 16,
        connLimit: 32,
      });
      expect(w.written.length).toBeGreaterThanOrEqual(2);
      expect(readFileSync(w.includePath, 'utf8')).toContain('burst=16');
      const notes = readActiveNginxLimitNotes(dir);
      expect(notes.exists).toBe(true);
      expect(notes.snippet).toContain('limit_req_zone');
      expect(defenseNginxConfPath(dir)).toBe(w.confPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
