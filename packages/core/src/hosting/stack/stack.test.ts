import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  expandComponents,
  expandUninstallComponents,
  isPurgePathAllowed,
  listPlanIds,
  STACK_PLANS,
} from './definitions.js';
import {
  emptyManifest,
  loadStackManifest,
  saveStackManifest,
  upsertComponent,
  setManifestMeta,
} from './manifest.js';
import { installStack, uninstallStack, listStackPlans, getStackStatus, scanStack } from './ops.js';
import type { HostExecutor } from '../../host/executor.js';

function mockHost(opts: {
  root?: boolean;
  execute?: boolean;
  bins?: string[];
  files?: Map<string, string>;
}): HostExecutor {
  const bins = new Set(opts.bins ?? []);
  const files = opts.files ?? new Map<string, string>();
  return {
    executeEnabled: () => opts.execute === true,
    isRoot: () => opts.root === true,
    pathExists: (p) => files.has(p) || p.includes('systemctl'),
    readFile: async (p) => files.get(p) ?? '',
    listDir: async () => [],
    writeFile: async (p, c) => {
      files.set(p, c);
    },
    deletePath: async (p) => {
      files.delete(p);
    },
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: 'inactive',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => {
      const s = argv.join(' ');
      if (s.includes('command -v')) {
        const m = s.match(/command -v (\S+)/);
        const bin = m?.[1];
        if (bin && bins.has(bin)) {
          return { stdout: `/usr/bin/${bin}\n`, stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (s.includes('apt-get')) {
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('stack definitions', () => {
  it('lists plans and expands recommended', () => {
    expect(listPlanIds()).toContain('recommended');
    expect(listPlanIds()).toContain('full');
    const r = expandComponents({ plan: 'recommended' }, { sqlServer: 'mariadb' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundles).toContain('web');
    expect(r.components).toContain('nginx');
    expect(r.components).toContain('mariadb-server');
    expect(r.components).not.toContain('mysql-server');
    expect(r.components).toContain('control-plane-product');
  });

  it('expands mysql exclusive choice', () => {
    const r = expandComponents({ plan: 'recommended' }, { sqlServer: 'mysql' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.components).toContain('mysql-server');
    expect(r.components).not.toContain('mariadb-server');
  });

  it('expandUninstallComponents skips control-plane base', () => {
    const c = expandUninstallComponents(['email', 'ftp']);
    expect(c).toContain('postfix');
    expect(c).toContain('vsftpd');
    expect(c).not.toContain('node');
  });

  it('isPurgePathAllowed is strict', () => {
    expect(isPurgePathAllowed('/')).toBe(false);
    expect(isPurgePathAllowed('/var/lib/mysql')).toBe(true);
    expect(isPurgePathAllowed('/etc/passwd')).toBe(false);
    expect(isPurgePathAllowed('/usr/local/cargo')).toBe(true);
  });

  it('full plan has more components than recommended', () => {
    const rec = expandComponents({ plan: 'recommended' });
    const full = expandComponents({ plan: 'full' });
    expect(rec.ok && full.ok).toBe(true);
    if (!rec.ok || !full.ok) return;
    expect(full.components.length).toBeGreaterThan(rec.components.length);
  });
});

describe('stack manifest', () => {
  it('load/save roundtrip via host', async () => {
    const files = new Map<string, string>();
    const host = mockHost({ root: true, execute: true, files });
    const dir = '/tmp/ysk-stack-test';
    let m = emptyManifest(dir, 'recommended');
    m = setManifestMeta(m, {
      plan: 'recommended',
      bundles: ['control-plane', 'web'],
      sqlServer: 'mariadb',
    });
    m = upsertComponent(m, 'nginx', {
      source: 'apt',
      packages: ['nginx'],
      units: ['nginx'],
      dataPaths: [],
    });
    const saved = await saveStackManifest(host, dir, m);
    expect(saved.ok).toBe(true);
    const loaded = await loadStackManifest(host, dir);
    expect(loaded.components.nginx?.packages).toContain('nginx');
    expect(loaded.bundles).toContain('web');
  });
});

describe('stack ops honesty', () => {
  it('installStack dry-run plans without execute', async () => {
    const host = mockHost({ root: false, execute: false });
    const r = await installStack({
      host,
      dataDir: '/tmp/ysk',
      plan: 'minimal',
      dryRun: true,
    });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.executed).toBe(false);
    expect(r.steps.some((s) => s.status === 'planned')).toBe(true);
  });

  it('installStack blocked without execute/root', async () => {
    const host = mockHost({ root: false, execute: false });
    const r = await installStack({
      host,
      dataDir: '/tmp/ysk',
      plan: 'minimal',
      dryRun: false,
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('installStack with execute updates manifest', async () => {
    const files = new Map<string, string>();
    const host = mockHost({ root: true, execute: true, bins: ['git', 'curl', 'jq', 'node'], files });
    const r = await installStack({
      host,
      dataDir: '/tmp/ysk-data',
      plan: 'minimal',
      dryRun: false,
    });
    expect(r.blocked).not.toBe(true);
    expect(r.executed).toBe(true);
    expect(r.manifest?.components).toBeTruthy();
  });

  it('uninstallStack keep vs purge dry-run', async () => {
    const files = new Map<string, string>();
    const host = mockHost({ root: true, execute: true, files });
    // seed manifest
    let m = emptyManifest('/tmp/ysk-data', 'custom');
    m = upsertComponent(m, 'nginx', {
      source: 'apt',
      packages: ['nginx'],
      units: ['nginx'],
      dataPaths: [],
    });
    await saveStackManifest(host, '/tmp/ysk-data', m);

    const dry = await uninstallStack({
      host,
      dataDir: '/tmp/ysk-data',
      components: ['nginx'],
      dataPolicy: 'keep',
      dryRun: true,
    });
    expect(dry.ok).toBe(true);
    expect(dry.steps[0]?.status).toBe('planned');

    const live = await uninstallStack({
      host,
      dataDir: '/tmp/ysk-data',
      components: ['nginx'],
      dataPolicy: 'keep',
      dryRun: false,
    });
    expect(live.executed).toBe(true);
    expect(live.manifest?.components.nginx).toBeUndefined();
  });

  it('uninstallStack blocked without root', async () => {
    const host = mockHost({ root: false, execute: true });
    const r = await uninstallStack({
      host,
      dataDir: '/tmp/ysk',
      components: ['nginx'],
      dryRun: false,
    });
    expect(r.blocked).toBe(true);
  });

  it('listStackPlans non-empty', () => {
    expect(listStackPlans().length).toBeGreaterThanOrEqual(3);
    expect(STACK_PLANS.recommended.bundles).toContain('defense');
  });

  it('getStackStatus + scanStack', async () => {
    const host = mockHost({ bins: ['nginx', 'ufw'], root: true, execute: true });
    const st = await getStackStatus({ host, dataDir: '/tmp/ysk' });
    expect(st.components.some((c) => c.id === 'nginx' && c.installed)).toBe(true);
    const scan = await scanStack({ host, dataDir: '/tmp/ysk' });
    expect(scan.manifest.inferred).toBe(true);
    expect(Object.keys(scan.manifest.components).length).toBeGreaterThan(0);
  });
});

describe('deploy JSON alignment (if present)', () => {
  it('recommended bundles match deploy/stack when file exists', () => {
    const p = join(process.cwd(), 'deploy/stack/bundles.json');
    // from packages/core cwd may differ
    const candidates = [
      p,
      join(process.cwd(), '../../deploy/stack/bundles.json'),
      join(process.cwd(), '../../../deploy/stack/bundles.json'),
    ];
    const found = candidates.find((c) => existsSync(c));
    if (!found) {
      expect(true).toBe(true);
      return;
    }
    const j = JSON.parse(readFileSync(found, 'utf8')) as {
      plans: Record<string, { bundles: string[] }>;
    };
    expect(j.plans.recommended.bundles).toEqual(STACK_PLANS.recommended.bundles);
    expect(j.plans.full.bundles).toEqual(STACK_PLANS.full.bundles);
  });
});
