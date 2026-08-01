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

  it('package limit fail + mail/db fail + ipv6 dns notes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wiz-br-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      store.snapshot.packages = [
        {
          id: 'pkg1',
          name: 'tiny',
          max_projects: 0,
          max_mailboxes: 1,
          max_databases: 0,
          disk_mb: 0,
          bandwidth_mb: 0,
          allow_ssh: false,
          allow_ftp: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      // max_projects 0 is unlimited in package-limits; use 1 with existing owned project
      store.snapshot.packages[0]!.max_projects = 1;
      store.snapshot.users = [
        {
          id: 'u1',
          username: 'bob',
          password_hash: 'h',
          password_salt: 's',
          roles: ['operator'],
          locale: 'zh-HK',
          package_id: 'pkg1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      store.snapshot.projects = [
        {
          id: 'owned',
          name: 'x',
          owner_user_id: 'u1',
          linux_user: 'u',
          linux_group: 'g',
          home_dir: '/h',
          runtime: 'node',
          env: 'production',
          status: 'active',
          os_provisioned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as never;
      store.persist();
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
      const blocked = await runCreateWizard({
        db: store as unknown as YskDatabase,
        host,
        dataDir: dir,
        projects: { create: async () => ({ project: { id: 'x', name: 'x' }, osProvision: { detail: '' } }) } as never,
        email: { create: () => ({ domain: { id: 'm', domain: 'd' } }) } as never,
        actor: 'admin',
        actorUserId: 'u1',
        body: { projectName: 'new' },
      });
      expect(blocked.ok).toBe(false);
      expect(blocked.steps[0]!.step).toBe('package');

      // clear package limits for partial-fail path
      store.snapshot.packages = [];
      store.snapshot.projects = [];
      store.persist();
      const partial = await runCreateWizard({
        db: store as unknown as YskDatabase,
        host,
        dataDir: dir,
        projects: {
          create: async (input: { name: string }) => ({
            project: { id: 'p2', name: input.name },
            osProvision: { detail: 'ok' },
            scaffold: { notes: [] },
          }),
        } as never,
        email: {
          create: () => {
            throw new Error('mail boom');
          },
        } as never,
        actor: 'admin',
        body: {
          projectName: 'Wiz',
          domain: 'wiz.example.com',
          runtime: 'php',
          serverIp: '10.0.0.9',
          serverIpv6: '2001:db8::9',
          createDns: true,
          createMail: true,
          createDb: true,
          dbName: 'wiz_db',
        },
      });
      expect(partial.projectId).toBe('p2');
      expect(partial.steps.some((s) => s.step === 'dns' && s.ok)).toBe(true);
      expect(partial.steps.some((s) => s.step === 'mail' && !s.ok)).toBe(true);
      expect(partial.steps.some((s) => s.step === 'database' && s.ok)).toBe(true);
      expect(partial.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
