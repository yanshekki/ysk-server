import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { runCreateWizard } from './wizard.js';
import type { YskDatabase } from '../db/database.js';
import type { HostExecutor } from '../host/executor.js';

describe('runCreateWizard', () => {
  it('creates project and optional drafts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wiz-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      const db = store as unknown as YskDatabase;
      const host: HostExecutor = {
        executeEnabled: () => false,
        isRoot: () => false,
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

      const projects = {
        create: async (input: { name: string; domain?: string; runtime?: string }) => ({
          project: {
            id: 'proj-1',
            name: input.name,
            domain: input.domain,
            runtime: input.runtime ?? 'node',
          },
          osProvision: { detail: 'os skipped' },
          scaffold: { notes: ['scaffold ok'] },
        }),
      };

      const email = {
        create: (input: { domain: string }) => ({
          domain: { id: 'mail-1', domain: input.domain },
        }),
      };

      const r = await runCreateWizard({
        db,
        host,
        dataDir: dir,
        projects: projects as never,
        email: email as never,
        actor: 'admin',
        body: {
          projectName: 'Demo',
          domain: 'demo.test',
          runtime: 'node',
          createDns: true,
          createMail: true,
          createDb: true,
          dbName: 'demo_db',
        },
      });
      expect(r.ok).toBe(true);
      expect(r.projectId).toBe('proj-1');
      expect(r.steps.some((s) => s.step === 'project' && s.ok)).toBe(true);
      expect(r.steps.some((s) => s.step === 'dns' && s.ok)).toBe(true);
      expect(r.steps.some((s) => s.step === 'mail' && s.ok)).toBe(true);
      expect(r.steps.some((s) => s.step === 'database' && s.ok)).toBe(true);
      expect(db.snapshot.dns_zones?.length).toBeGreaterThan(0);
      expect(db.snapshot.mysql_databases?.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stops when project create fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wiz-fail-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      const host: HostExecutor = {
        executeEnabled: () => false,
        isRoot: () => false,
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
      const r = await runCreateWizard({
        db: store as unknown as YskDatabase,
        host,
        dataDir: dir,
        projects: {
          create: async () => {
            throw new Error('name taken');
          },
        } as never,
        email: { create: () => ({ domain: { id: 'x', domain: 'x' } }) } as never,
        actor: 'admin',
        body: { projectName: 'x' },
      });
      expect(r.ok).toBe(false);
      expect(r.steps[0].step).toBe('project');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
