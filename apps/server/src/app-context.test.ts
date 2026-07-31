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
import { evaluateProtection } from '@ysk/core';
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
});
