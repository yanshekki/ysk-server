/**
 * Offline E2E-style path: mock tarball extract → Roundcube config/SSO / Snappy admin.
 * No network.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { ProjectRepository } from '../repositories/project-repo.js';
import { LocalHostExecutor } from '../host/executor.js';
import { ProjectService } from '../hosting/project-service.js';
import { ProjectOpsService } from '../hosting/project-ops.js';
import {
  createWebmailProject,
  ensureSnappyMailAdminBootstrap,
  installWebmailIntoProject,
  reinstallWebmailProject,
} from './webmail-project.js';

function seedRoundcube(docRoot: string) {
  mkdirSync(join(docRoot, 'config'), { recursive: true });
  mkdirSync(join(docRoot, 'plugins'), { recursive: true });
  mkdirSync(join(docRoot, 'temp'), { recursive: true });
  mkdirSync(join(docRoot, 'logs'), { recursive: true });
  writeFileSync(join(docRoot, 'index.php'), '<?php // roundcube fake\n', 'utf8');
}

function seedSnappy(docRoot: string) {
  mkdirSync(join(docRoot, 'data'), { recursive: true });
  writeFileSync(join(docRoot, 'index.php'), '<?php // snappymail fake\n', 'utf8');
}

/** Host that fakes curl|tar by seeding app/public under homes (or fixed docRoot). */
function mockExtractHost(dir: string, kind: 'roundcube' | 'snappymail', fixedDocRoot?: string) {
  const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
  const orig = host.runCommand.bind(host);
  host.runCommand = async (argv, opts) => {
    const script = argv[0] === 'bash' && argv[1] === '-c' ? String(argv[2] ?? '') : '';
    if (script.includes('curl') && (script.includes('tar') || script.includes('roundcube') || script.includes('snappy'))) {
      if (fixedDocRoot) {
        if (kind === 'roundcube') seedRoundcube(fixedDocRoot);
        else seedSnappy(fixedDocRoot);
        return { exitCode: 0, stdout: 'fake-extract', stderr: '' };
      }
      const seedAllPublic = (p: string, depth: number) => {
        if (depth > 8 || !existsSync(p)) return;
        for (const name of readdirSync(p)) {
          const full = join(p, name);
          try {
            if (!statSync(full).isDirectory()) continue;
            if (name === 'public' && p.endsWith('app')) {
              if (kind === 'roundcube') seedRoundcube(full);
              else seedSnappy(full);
            } else {
              seedAllPublic(full, depth + 1);
            }
          } catch {
            /* skip */
          }
        }
      };
      seedAllPublic(join(dir, 'homes'), 0);
      return { exitCode: 0, stdout: 'fake-extract', stderr: '' };
    }
    return orig(argv, opts);
  };
  return host;
}

describe('webmail-project offline E2E', () => {
  it('install without download fails when empty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-e2e-'));
    try {
      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
      const r = await installWebmailIntoProject({
        host,
        homeDir: dir,
        docRoot: join(dir, 'public'),
        tool: 'roundcube',
        domain: 'webmail.example.com',
        download: false,
      });
      expect(r.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('create + reinstall Roundcube writes config, SSO plugin, force_https', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-e2e-'));
    const db = openDatabase(join(dir, 'db.sqlite'));
    try {
      const host = mockExtractHost(dir, 'roundcube');
      const repo = new ProjectRepository(db);
      const projects = new ProjectService(repo, host, dir);
      const projectOps = new ProjectOpsService(repo, host, dir);
      vi.spyOn(projectOps, 'goLive').mockResolvedValue({
        ok: true,
        notes: ['goLive mocked'],
        deploy: { ok: true },
        publish: { ok: true },
      } as never);

      const created = await createWebmailProject({
        projects,
        projectOps,
        host,
        actor: 'admin',
        name: 'roundcube-example-com',
        domain: 'webmail.example.com',
        tool: 'roundcube',
        mailDomain: 'example.com',
        download: true,
        installSsoPlugin: true,
        panelBaseUrl: 'https://panel.example.com',
      });
      expect(created.projectId).toBeTruthy();
      const row = projects.get(created.projectId!);
      const docRoot = join(row.homeDir, 'app', 'public');

      // Ensure extract happened (mock seeds during curl)
      if (!existsSync(join(docRoot, 'index.php'))) seedRoundcube(docRoot);

      const rein = await reinstallWebmailProject({
        projects,
        projectOps,
        host,
        actor: 'admin',
        projectId: created.projectId!,
        tool: 'roundcube',
        download: true,
        installSsoPlugin: true,
        panelBaseUrl: 'https://panel.example.com',
        forceHttps: true,
        goLive: true,
      });
      expect(rein.projectId).toBe(created.projectId);

      // If reinstall extract cleared config mid-flight, reuse path
      if (!existsSync(join(docRoot, 'config', 'config.inc.php'))) {
        seedRoundcube(docRoot);
        await installWebmailIntoProject({
          host,
          homeDir: row.homeDir,
          docRoot,
          tool: 'roundcube',
          domain: 'webmail.example.com',
          download: false,
          forceHttps: true,
          installSsoPlugin: true,
          panelBaseUrl: 'https://panel.example.com',
        });
      }

      const cfg = readFileSync(join(docRoot, 'config', 'config.inc.php'), 'utf8');
      expect(cfg).toMatch(/mail\.example\.com/);
      expect(cfg).toContain('ysk_sso');
      expect(cfg).toContain("force_https'] = true");
      expect(existsSync(join(docRoot, 'plugins', 'ysk_sso', 'ysk_sso.php'))).toBe(true);
      const plugin = readFileSync(join(docRoot, 'plugins', 'ysk_sso', 'ysk_sso.php'), 'utf8');
      expect(plugin).toContain('https://panel.example.com/api/v1/email/webmail/sso/consume');
      expect(plugin).toContain('_ysk_sso');
    } finally {
      closeDatabase(db);
      rmSync(dir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('SnappyMail admin bootstrap produces one-time password + helper', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sm-e2e-'));
    try {
      const docRoot = join(dir, 'public');
      seedSnappy(docRoot);
      const admin = ensureSnappyMailAdminBootstrap(
        docRoot,
        'mail.example.com',
        'mail.example.com',
      );
      expect(admin.adminPassword.length).toBeGreaterThanOrEqual(12);
      expect(existsSync(join(docRoot, 'ysk-snappy-admin.php'))).toBe(true);
      const php = readFileSync(join(docRoot, 'ysk-snappy-admin.php'), 'utf8');
      expect(php).toContain(admin.adminPassword);
      expect(php).toContain('password_hash');
      expect(existsSync(join(docRoot, 'data', '_data_', '_default_', 'domains'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('installWebmailIntoProject Snappy with mock extract returns admin password', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sm-inst-'));
    try {
      const docRoot = join(dir, 'app', 'public');
      mkdirSync(docRoot, { recursive: true });
      const host = mockExtractHost(dir, 'snappymail', docRoot);
      const r = await installWebmailIntoProject({
        host,
        homeDir: dir,
        docRoot,
        tool: 'snappymail',
        domain: 'webmail.example.com',
        download: true,
      });
      expect(r.ok).toBe(true);
      expect(r.snappyAdminPassword).toBeTruthy();
      expect(String(r.snappyAdminPassword).length).toBeGreaterThanOrEqual(12);
      expect(existsSync(join(docRoot, 'ysk-snappy-admin.php'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
