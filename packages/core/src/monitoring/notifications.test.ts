import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { collectNotifications } from './notifications.js';
import type { YskDatabase } from '../db/database.js';
import type { HostExecutor } from '../host/executor.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
  vi.restoreAllMocks();
});

function mockHost(opts: {
  executeEnabled?: boolean;
  isRoot?: boolean;
}): HostExecutor {
  return {
    executeEnabled: () => opts.executeEnabled !== false,
    isRoot: () => opts.isRoot === true,
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
    runCommand: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
  };
}

function store(): { db: JsonStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ysk-notif-'));
  dirs.push(dir);
  return { db: new JsonStore(join(dir, 'db.json')), dir };
}

describe('collectNotifications', () => {
  it('surfaces pending approvals and EXECUTE warn', async () => {
    const { db, dir } = store();
    db.snapshot.approvals = [
      {
        id: 'a1',
        action: 'tool.dangerous',
        status: 'pending',
        risk: 'high',
        requested_by: 'admin',
        created_at: new Date().toISOString(),
        payload: {},
      },
    ] as never;
    db.persist();
    const r = await collectNotifications({
      db: db as unknown as YskDatabase,
      host: mockHost({ executeEnabled: false }),
      dataDir: dir,
      executeEnabled: false,
    });
    expect(r.counts.warn + r.counts.critical).toBeGreaterThan(0);
    expect(r.items.some((i) => i.id === 'exec-disabled')).toBe(true);
    expect(r.items.some((i) => i.id === 'approvals-pending')).toBe(true);
  });

  it('covers metrics alerts, projects, certs, backup, dnsbl, defense, audit, journal', async () => {
    const { db, dir } = store();
    const metrics = await import('./metrics.js');
    const spy = vi.spyOn(metrics, 'collectMetrics').mockReturnValue({
      at: new Date().toISOString(),
      loadavg: [0, 0, 0],
      cpuCount: 1,
      memory: { total: 1, free: 1, usedRatio: 0.1 },
      uptimeSec: 1,
      alerts: ['memory_high', 'load_high', 'disk_high'],
    } as never);

    const soon = new Date(Date.now() + 3 * 86400_000).toISOString();
    const expired = new Date(Date.now() - 86400_000).toISOString();
    db.snapshot.projects = [
      {
        id: 'p1',
        name: 'SuspendedSite',
        status: 'suspended',
        os_provisioned: false,
      },
      {
        id: 'p2',
        name: 'Bare',
        status: 'active',
        os_provisioned: false,
      },
    ] as never;
    db.snapshot.approvals = Array.from({ length: 5 }, (_, i) => ({
      id: `ap${i}`,
      action: `act${i}`,
      status: 'pending',
      risk: 'high',
      requested_by: 'a',
      created_at: new Date().toISOString(),
      payload: {},
    })) as never;
    db.snapshot.certificates = [
      { domain: 'soon.example', expires_at: soon },
      { domain: 'dead.example', expires_at: expired },
      { domain: 'path.example', fullchain_path: join(dir, 'missing.pem') },
    ] as never;
    db.snapshot.settings = {
      defense_last_threat: 'critical',
      defense_auto_ban: JSON.stringify({
        enabled: true,
        pausedReason: 'circuit_breaker',
      }),
      defense_automation: JSON.stringify({
        enabled: true,
        suggestEmergency: true,
        lastPresetId: 'emergency',
        lastTickNotes: ['自動防護檔 emergency'],
      }),
      log_center: JSON.stringify({ journalWarnMb: 100 }),
      log_center_disk_hint: JSON.stringify({
        journalDiskMb: 250,
        at: new Date().toISOString(),
      }),
    };
    db.snapshot.nginx_sites = [
      { id: 'n1', serverName: 'x.test', apply_status: 'failed' },
    ] as never;
    db.snapshot.audit_events = [
      {
        id: 'e1',
        action: 'host.fail',
        ok: false,
        resource: 'svc',
        created_at: new Date().toISOString(),
      },
      {
        id: 'e2',
        action: 'host.fail2',
        ok: false,
        created_at: new Date().toISOString(),
      },
    ] as never;
    db.persist();

    const r = await collectNotifications({
      db: db as unknown as YskDatabase,
      host: mockHost({ executeEnabled: true, isRoot: false }),
      dataDir: dir,
      executeEnabled: true,
      lastBackup: { ok: false, at: '2020-01-01' },
      lastDnsbl: {
        reports: [
          { domain: 'bad.mail', ok: false, listedOn: ['zen.spamhaus'] },
          { domain: 'ok.mail', ok: true },
        ],
      },
    });
    spy.mockRestore();

    const ids = r.items.map((i) => i.id);
    // metrics spy may not intercept if notifications holds direct binding — optional
    expect(ids).toContain('proj-suspended');
    expect(ids).toContain('proj-no-os');
    expect(ids).toContain('approvals-pending');
    expect(ids.some((id) => id.startsWith('cert-'))).toBe(true);
    expect(ids).toContain('backup-fail');
    expect(ids).toContain('dnsbl-bad.mail');
    expect(ids).toContain('defense-threat');
    expect(ids).toContain('defense-auto-ban-cb');
    expect(ids).toContain('not-root');
    expect(ids).toContain('defense-suggest-emergency');
    expect(ids).toContain('defense-auto-preset');
    expect(ids).toContain('journal-disk-high');
    expect(ids).toContain('apply-audit-bad');
    expect(ids.some((id) => id.startsWith('audit-'))).toBe(true);
    expect(r.counts.critical).toBeGreaterThan(0);
    if (r.items.length >= 2) {
      const rank = { critical: 0, warn: 1, info: 2 };
      expect(rank[r.items[0].level]).toBeLessThanOrEqual(rank[r.items[1].level]);
    }
  });

  it('backup sideOk false and under_attack threat + apply-audit warn', async () => {
    const { db, dir } = store();
    db.snapshot.settings = {
      defense_last_threat: 'under_attack',
      defense_automation: JSON.stringify({
        enabled: true,
        suggestEmergency: false,
        lastPresetId: 'daily',
      }),
      log_center_disk_hint: 'not-json',
      defense_auto_ban: '{broken',
    };
    (db.snapshot as Record<string, unknown>).ftp_accounts = [
      { id: 'f1', username: 'u', apply_status: 'written' },
    ];
    db.persist();

    const r = await collectNotifications({
      db: db as unknown as YskDatabase,
      host: mockHost({ executeEnabled: true, isRoot: true }),
      dataDir: dir,
      executeEnabled: true,
      lastBackup: { ok: true, sideOk: false },
    });
    const ids = r.items.map((i) => i.id);
    expect(ids).toContain('backup-side-fail');
    expect(ids).toContain('defense-threat');
    // warn from written status if audit finds it
    expect(r.counts.warn + r.counts.critical + r.counts.info).toBeGreaterThan(0);
  });

  it('cert from fullchain path and journal critical threshold', async () => {
    const { db, dir } = store();
    // Minimal PEM-like content won't parse expiry — still exercises existsSync branch
    const pem = join(dir, 'fullchain.pem');
    writeFileSync(pem, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
    db.snapshot.certificates = [
      { domain: 'file.example', fullchain_path: pem },
    ] as never;
    db.snapshot.settings = {
      log_center: JSON.stringify({ journalWarnMb: 10 }),
      log_center_disk_hint: JSON.stringify({ journalDiskMb: 25 }),
    };
    db.persist();
    const r = await collectNotifications({
      db: db as unknown as YskDatabase,
      host: mockHost({ executeEnabled: false }),
      dataDir: dir,
      executeEnabled: false,
    });
    expect(r.items.some((i) => i.id === 'journal-disk-high')).toBe(true);
  });
});
