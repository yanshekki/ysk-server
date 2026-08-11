import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  cleanupApacheServerNameConflicts,
  removeApacheArtifact,
  retireOrphanApacheConfsForDomain,
  sanitizeApacheConfBasename,
} from './artifacts.js';
import { listMergedApacheSites } from './sites-list.js';
import { LocalHostExecutor } from '../../host/executor.js';

describe('apache artifacts', () => {
  it('sanitizes basenames', () => {
    expect(sanitizeApacheConfBasename('ok.conf')).toBe('ok.conf');
    expect(sanitizeApacheConfBasename('../etc/passwd')).toBeNull();
    expect(sanitizeApacheConfBasename('a/b.conf')).toBeNull();
    expect(sanitizeApacheConfBasename('artifact:foo.conf')).toBe('foo.conf');
  });

  it('removes orphan conf and refuses owned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ap-art-'));
    const sitesDir = join(dir, 'apache', 'sites');
    mkdirSync(sitesDir, { recursive: true });
    writeFileSync(
      join(sitesDir, 'ysk-phpuser.conf'),
      'ServerName app.example.com\nDocumentRoot /home/phpuser/app/public\n',
      'utf8',
    );
    writeFileSync(
      join(sitesDir, 'orphan.conf'),
      'ServerName app.example.com\nDocumentRoot /var/www/old\n',
      'utf8',
    );
    const host = new LocalHostExecutor({
      allowedWriteRoots: [dir],
      executeEnabled: false,
    });
    const projects = [
      {
        id: 'p1',
        domain: 'app.example.com',
        runtime: 'php',
        linux_user: 'phpuser',
        home_dir: '/home/phpuser',
      },
    ];

    const owned = await removeApacheArtifact({
      dataDir: dir,
      host,
      fileOrId: 'artifact:ysk-phpuser.conf',
      projects,
    });
    expect(owned.ok).toBe(false);
    expect(owned.code).toBe('owned');
    expect(existsSync(join(sitesDir, 'ysk-phpuser.conf'))).toBe(true);

    const gone = await removeApacheArtifact({
      dataDir: dir,
      host,
      fileOrId: 'artifact:orphan.conf',
      projects,
    });
    expect(gone.ok).toBe(true);
    expect(gone.removed).toBe('orphan.conf');
    expect(existsSync(join(sitesDir, 'orphan.conf'))).toBe(false);
    expect(gone.requiresExecute).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('cleanupConflicts removes artifact peers only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ap-cl-'));
    const sitesDir = join(dir, 'apache', 'sites');
    mkdirSync(sitesDir, { recursive: true });
    writeFileSync(
      join(sitesDir, 'ysk-phpuser.conf'),
      'ServerName app.example.com\nDocumentRoot /home/phpuser/app/public\n',
      'utf8',
    );
    writeFileSync(
      join(sitesDir, 'stale.conf'),
      'ServerName app.example.com\nDocumentRoot /old\n',
      'utf8',
    );
    const host = new LocalHostExecutor({
      allowedWriteRoots: [dir],
      executeEnabled: false,
    });
    const projects = [
      {
        id: 'p1',
        domain: 'app.example.com',
        runtime: 'php',
        linux_user: 'phpuser',
      },
    ];
    const r = await cleanupApacheServerNameConflicts({
      dataDir: dir,
      host,
      projects,
    });
    expect(r.removed).toContain('stale.conf');
    expect(existsSync(join(sitesDir, 'ysk-phpuser.conf'))).toBe(true);
    expect(existsSync(join(sitesDir, 'stale.conf'))).toBe(false);
    const rows = listMergedApacheSites({ dataDir: dir, projects });
    expect(rows.some((x) => x.source === 'artifact')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('retireOrphanApacheConfsForDomain keeps owned keep file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ap-ret-'));
    const sitesDir = join(dir, 'apache', 'sites');
    mkdirSync(sitesDir, { recursive: true });
    writeFileSync(
      join(sitesDir, 'ysk-newuser.conf'),
      'ServerName php.example.com\nDocumentRoot /new\n',
      'utf8',
    );
    writeFileSync(
      join(sitesDir, 'old-uuid.conf'),
      'ServerName php.example.com\nDocumentRoot /old\n',
      'utf8',
    );
    const host = new LocalHostExecutor({
      allowedWriteRoots: [dir],
      executeEnabled: false,
    });
    const projects = [
      {
        id: 'p1',
        domain: 'php.example.com',
        runtime: 'php',
        linux_user: 'newuser',
      },
    ];
    const r = await retireOrphanApacheConfsForDomain({
      dataDir: dir,
      host,
      domain: 'php.example.com',
      keepBasename: 'ysk-newuser.conf',
      projects,
    });
    expect(r.removed).toContain('old-uuid.conf');
    expect(existsSync(join(sitesDir, 'ysk-newuser.conf'))).toBe(true);
    expect(existsSync(join(sitesDir, 'old-uuid.conf'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
