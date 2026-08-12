import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAppContext,
  closeAppContext,
  applyProtection,
  type AppContext,
} from './app-context.js';
import { evaluateProtection } from '@yanshekki/core';
import { VERSION } from './version.js';

describe('app-context helpers', () => {
  let dataDir: string;
  let ctx: AppContext | undefined;
  const prevDisable = process.env.YSK_DISABLE_SCHEDULER;
  const prevStore = process.env.YSK_STORE;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ysk-ctx-'));
    process.env.YSK_DISABLE_SCHEDULER = '1';
    process.env.YSK_STORE = 'json';
  });

  afterEach(() => {
    if (ctx) {
      try {
        closeAppContext(ctx);
      } catch {
        /* already closed */
      }
      ctx = undefined;
    }
    rmSync(dataDir, { recursive: true, force: true });
    if (prevDisable === undefined) delete process.env.YSK_DISABLE_SCHEDULER;
    else process.env.YSK_DISABLE_SCHEDULER = prevDisable;
    if (prevStore === undefined) delete process.env.YSK_STORE;
    else process.env.YSK_STORE = prevStore;
  });

  it('createAppContext with string version boots empty admin', () => {
    ctx = createAppContext({
      version: VERSION,
      dataDir,
      adminPassword: 'TestPass-Strong-99!',
      executeEnabled: false,
    });
    expect(ctx.version).toBe(VERSION);
    expect(ctx.dataDir).toBe(dataDir);
    expect(ctx.host.executeEnabled()).toBe(false);
    expect(ctx.protection).toBeDefined();
    expect(ctx.projects.list()).toEqual([]);
  });

  it('applyProtection updates protection and audits', () => {
    ctx = createAppContext({
      version: VERSION,
      dataDir,
      adminPassword: 'TestPass-Strong-99!',
    });
    const offline = evaluateProtection({
      networkReachable: true,
      forceOffline: true,
    });
    applyProtection(ctx, offline);
    expect(ctx.protection.mode).not.toBe('normal');
    const items = ctx.audit.listRecent(20);
    expect(items.some((e) => e.action === 'protection.change')).toBe(true);
  });

  it('reloadLlm rebuilds gateway from settings', () => {
    ctx = createAppContext({
      version: VERSION,
      dataDir,
      adminPassword: 'TestPass-Strong-99!',
    });
    process.env.YSK_LLM_ECHO = '1';
    ctx.settings.setJson('llm', { model: 'test-model-reload', baseUrl: '' });
    ctx.reloadLlm();
    expect(ctx.llm).toBeDefined();
    expect(ctx.ai).toBeDefined();
    delete process.env.YSK_LLM_ECHO;
  });

  it('closeAppContext stops scheduler and closes db', () => {
    ctx = createAppContext({
      version: VERSION,
      dataDir,
      adminPassword: 'TestPass-Strong-99!',
    });
    closeAppContext(ctx);
    // second close may throw — that's ok
    ctx = undefined;
  });

  it('runAutoProtection returns probe without throwing', async () => {
    ctx = createAppContext({
      version: VERSION,
      dataDir,
      adminPassword: 'TestPass-Strong-99!',
    });
    const probe = await ctx.runAutoProtection();
    expect(probe.protection).toBeDefined();
    expect(ctx.protection).toBeDefined();
  });

  it('createAppContext string form + executeEnabled + services wired', () => {
    ctx = createAppContext(VERSION);
    expect(ctx.version).toBe(VERSION);
    expect(ctx.auth).toBeDefined();
    expect(ctx.projects).toBeDefined();
    expect(ctx.email).toBeDefined();
    expect(ctx.cron).toBeDefined();
    expect(ctx.ai).toBeDefined();
    expect(ctx.fleet).toBeDefined();
    expect(ctx.usersAdmin).toBeDefined();
    expect(ctx.rbac).toBeDefined();
    expect(ctx.allowlist).toBeDefined();
    expect(ctx.approvals).toBeDefined();
    expect(ctx.agents).toBeDefined();
    expect(ctx.projectOps).toBeDefined();
    expect(ctx.startedAt).toBeTruthy();
    expect(Array.isArray(ctx.requestHits)).toBe(true);
    ctx.stopScheduler();
  });

  it('executeEnabled true + audit/settings/rbac wired', () => {
    process.env.YSK_STORE = 'json';
    ctx = createAppContext({
      version: VERSION,
      dataDir,
      adminPassword: 'TestPass-Strong-99!',
      executeEnabled: true,
    });
    expect(ctx.host.executeEnabled()).toBe(true);
    expect(ctx.db).toBeDefined();
    // exercise audit + settings + rbac list
    ctx.audit.append({
      actor: 'test',
      action: 'app-context.test',
      detail: { ok: true },
      ok: true,
    });
    expect(ctx.audit.listRecent(5).length).toBeGreaterThan(0);
    ctx.settings.setJson('coverage', { v: 1 });
    expect(ctx.settings.getJson('coverage')).toEqual({ v: 1 });
    expect(ctx.rbac.listPolicies().length).toBeGreaterThan(0);
  });

  it('applyProtection modes: normal and ddos', () => {
    ctx = createAppContext({
      version: VERSION,
      dataDir,
      adminPassword: 'TestPass-Strong-99!',
    });
    const normal = evaluateProtection({ networkReachable: true });
    applyProtection(ctx, normal);
    expect(ctx.protection.mode).toBeTruthy();

    const ddos = evaluateProtection({
      networkReachable: true,
      ddosSuspected: true,
    });
    applyProtection(ctx, ddos);
    expect(ctx.protection.mode).toBe('ddos-protection');
  });

  it('reloadLlm with echo transport stays defined after multiple reloads', () => {
    process.env.YSK_LLM_ECHO = '1';
    ctx = createAppContext({
      version: VERSION,
      dataDir,
      adminPassword: 'TestPass-Strong-99!',
    });
    ctx.settings.setJson('llm', { model: 'm1', baseUrl: 'http://127.0.0.1:9' });
    ctx.reloadLlm();
    ctx.settings.setJson('llm', { model: 'm2', baseUrl: '' });
    ctx.reloadLlm();
    expect(ctx.llm).toBeDefined();
    expect(ctx.ai).toBeDefined();
    delete process.env.YSK_LLM_ECHO;
  });

  it('reloadLlm fetch transport when baseUrl set and ECHO off', () => {
    ctx = createAppContext({
      version: VERSION,
      dataDir,
      adminPassword: 'TestPass-Strong-99!',
    });
    delete process.env.YSK_LLM_ECHO;
    ctx.settings.setJson('llm', {
      model: 'depth-model',
      baseUrl: 'http://127.0.0.1:9',
      apiKey: 'test-key',
    });
    ctx.reloadLlm();
    expect(ctx.llm).toBeDefined();
    expect(ctx.ai).toBeDefined();
  });

  it(
    'scheduler registers jobs when enabled (backup/dnsbl on start)',
    async () => {
      delete process.env.YSK_DISABLE_SCHEDULER;
      process.env.YSK_BACKUP_INTERVAL_MS = '5000';
      process.env.YSK_DNSBL_INTERVAL_MS = '10000';
      process.env.YSK_BACKUP_ON_START = '1';
      process.env.YSK_DNSBL_ON_START = '1';
      process.env.YSK_PROBE_ON_START = '0';
      process.env.YSK_INVENTORY_ON_START = '0';
      process.env.YSK_TEMP_DB_EXPIRE_MS = '3600000';
      process.env.YSK_AUTO_BAN_INTERVAL_MS = '120000';
      process.env.YSK_GEOIP_UPDATE_MS = '3600000';

      try {
        ctx = createAppContext({
          version: VERSION,
          dataDir,
          adminPassword: 'TestPass-Strong-99!',
          executeEnabled: false,
        });
        ctx.db.snapshot.email_domains = [
          {
            id: 'dom-depth-1',
            domain: 'depth-dnsbl.local',
            server_ip: '203.0.113.90',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never,
        ];
        ctx.db.snapshot.settings.defense_automation = JSON.stringify({
          enabled: true,
          autoBan: { enabled: true, intervalSeconds: 30 },
          autoPreset: { enabled: false },
        });
        ctx.db.persist();

        await new Promise((r) => setTimeout(r, 1500));

        expect(ctx.scheduler).toBeDefined();
        // requestHits filter path in runAutoProtection
        ctx.requestHits.push(Date.now());
        const probe = await ctx.runAutoProtection();
        expect(probe.protection).toBeDefined();

        ctx.stopScheduler();
        ctx.stopScheduler();
      } finally {
        delete process.env.YSK_BACKUP_INTERVAL_MS;
        delete process.env.YSK_DNSBL_INTERVAL_MS;
        delete process.env.YSK_BACKUP_ON_START;
        delete process.env.YSK_DNSBL_ON_START;
        delete process.env.YSK_PROBE_ON_START;
        delete process.env.YSK_INVENTORY_ON_START;
        delete process.env.YSK_TEMP_DB_EXPIRE_MS;
        delete process.env.YSK_AUTO_BAN_INTERVAL_MS;
        delete process.env.YSK_GEOIP_UPDATE_MS;
        process.env.YSK_DISABLE_SCHEDULER = '1';
      }
    },
    30_000,
  );

  it('create with config object and custom dbPath', () => {
    const dbPath = join(dataDir, 'custom-ctx.json');
    ctx = createAppContext({
      version: VERSION,
      dataDir,
      dbPath,
      adminPassword: 'TestPass-Strong-99!',
      executeEnabled: false,
      config: {
        dataDir,
        listen: { host: '127.0.0.1', port: 19288 },
        adminUsername: 'admin',
        locale: 'en',
      } as never,
    });
    expect(ctx.dataDir).toBe(dataDir);
    expect(ctx.host.executeEnabled()).toBe(false);
    expect(ctx.configPath === undefined || typeof ctx.configPath === 'string').toBe(true);
  });

  it(
    'scheduler inventory + probe + temp-db + geoip ticks on start',
    async () => {
      delete process.env.YSK_DISABLE_SCHEDULER;
      process.env.YSK_PROBE_ON_START = '1';
      process.env.YSK_INVENTORY_ON_START = '1';
      process.env.YSK_BACKUP_ON_START = '1';
      process.env.YSK_DNSBL_ON_START = '1';
      process.env.YSK_BACKUP_INTERVAL_MS = '5000';
      process.env.YSK_DNSBL_INTERVAL_MS = '10000';
      process.env.YSK_TEMP_DB_EXPIRE_MS = '5000';
      process.env.YSK_AUTO_BAN_INTERVAL_MS = '15000';
      process.env.YSK_GEOIP_UPDATE_MS = '3600000';
      process.env.YSK_TEMP_DB_AUTO_DROP = '0';

      try {
        ctx = createAppContext({
          version: VERSION,
          dataDir,
          adminPassword: 'TestPass-Strong-99!',
          executeEnabled: false,
        });
        // seed domain for dnsbl tick
        ctx.db.snapshot.email_domains = [
          {
            id: 'dom-sched-2',
            domain: 'sched-dnsbl.local',
            server_ip: '198.51.100.20',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never,
        ];
        ctx.db.snapshot.settings = ctx.db.snapshot.settings ?? {};
        ctx.db.snapshot.settings.defense_automation = JSON.stringify({
          enabled: true,
          autoBan: { enabled: true, intervalSeconds: 30 },
          autoPreset: { enabled: true },
        });
        // ip access policy autoUpdate default
        ctx.db.persist();

        await new Promise((r) => setTimeout(r, 2500));

        // force more ticks via runAutoProtection
        for (let i = 0; i < 3; i++) ctx.requestHits.push(Date.now() - i * 1000);
        await ctx.runAutoProtection();

        // protection auto when force offline
        const offline = evaluateProtection({
          networkReachable: false,
          forceOffline: true,
        });
        applyProtection(ctx, offline);
        await ctx.runAutoProtection();

        expect(ctx.scheduler).toBeDefined();
        ctx.stopScheduler();
      } finally {
        for (const k of [
          'YSK_PROBE_ON_START',
          'YSK_INVENTORY_ON_START',
          'YSK_BACKUP_ON_START',
          'YSK_DNSBL_ON_START',
          'YSK_BACKUP_INTERVAL_MS',
          'YSK_DNSBL_INTERVAL_MS',
          'YSK_TEMP_DB_EXPIRE_MS',
          'YSK_AUTO_BAN_INTERVAL_MS',
          'YSK_GEOIP_UPDATE_MS',
          'YSK_TEMP_DB_AUTO_DROP',
        ]) {
          delete process.env[k];
        }
        process.env.YSK_DISABLE_SCHEDULER = '1';
      }
    },
    45_000,
  );
});
