import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import {
  exportControlPlaneSnapshot,
  rebuildManagedConfigs,
  listControlPlaneExports,
  resolveExportFile,
  listManagedNginxDetailed,
} from './rebuild.js';
import type { YskDatabase } from '../db/database.js';
import type { HostExecutor } from '../host/executor.js';
import { writeFileSync, mkdirSync } from 'node:fs';

describe('rebuild', () => {
  it('exports snapshot, lists archives, dry-run and blocks sync without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rebuild-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      store.snapshot.projects = [
        {
          id: 'p1',
          name: 'n',
          domain: 'n.test',
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
      const db = store as unknown as YskDatabase;
      const snap = exportControlPlaneSnapshot(db);
      expect(snap.counts.projects).toBe(1);
      expect(snap.projects[0].domain).toBe('n.test');

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
      const r = await rebuildManagedConfigs({
        dataDir: dir,
        host,
        db,
        writeExport: true,
        syncNginx: false,
      });
      expect(r.exportPath && existsSync(r.exportPath)).toBe(true);
      expect(r.notes.length).toBeGreaterThan(0);
      expect(r.nginxConfDetails).toBeDefined();

      const hist = listControlPlaneExports(dir);
      expect(hist.length).toBeGreaterThanOrEqual(1);
      expect(resolveExportFile(dir, hist[0]!.name).ok).toBe(true);
      expect(resolveExportFile(dir, '../evil.json').ok).toBe(false);

      const dry = await rebuildManagedConfigs({
        dataDir: dir,
        host,
        db,
        writeExport: false,
        dryRun: true,
      });
      expect(dry.ok).toBe(true);
      expect(dry.dryRun).toBe(true);

      const blocked = await rebuildManagedConfigs({
        dataDir: dir,
        host,
        db,
        writeExport: false,
        syncNginx: true,
      });
      expect(blocked.blocked).toBe(true);

      mkdirSync(join(dir, 'nginx', 'conf.d'), { recursive: true });
      writeFileSync(join(dir, 'nginx', 'conf.d', 'demo.conf'), 'server {}\n', 'utf8');
      expect(listManagedNginxDetailed(dir).some((c) => c.name === 'demo.conf')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
