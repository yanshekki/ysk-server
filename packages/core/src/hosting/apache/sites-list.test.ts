import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApacheSite } from './service.js';
import { listMergedApacheSites, readApacheSiteConf } from './sites-list.js';

describe('listMergedApacheSites', () => {
  it('merges PHP projects + standalone + disk artifacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ap-list-'));
    createApacheSite(dir, {
      serverName: 'solo.example.com',
      kind: 'proxy',
      upstream: 'http://127.0.0.1:3000',
    });

    const sitesDir = join(dir, 'apache', 'sites');
    mkdirSync(sitesDir, { recursive: true });
    writeFileSync(
      join(sitesDir, 'ysk-phpuser.conf'),
      `<VirtualHost 127.0.0.1:8080>
  ServerName app.example.com
  DocumentRoot /home/phpuser/app/public
</VirtualHost>
`,
      'utf8',
    );
    writeFileSync(
      join(sitesDir, 'orphan.conf'),
      `ServerName orphan.example.com
DocumentRoot /var/www/orphan
`,
      'utf8',
    );

    const rows = listMergedApacheSites({
      dataDir: dir,
      projects: [
        {
          id: 'p1',
          name: 'PHP App',
          domain: 'app.example.com',
          runtime: 'php',
          linux_user: 'phpuser',
          home_dir: '/home/phpuser',
          doc_root: 'app/public',
          runtime_version: '8.2',
        },
        {
          id: 'p2',
          name: 'Node',
          domain: 'node.example.com',
          runtime: 'node',
        },
        {
          id: 'p3',
          name: 'No domain PHP',
          runtime: 'php',
          linux_user: 'lonely',
          home_dir: '/home/lonely',
        },
      ],
    });

    expect(rows.some((r) => r.id === 'project:p1' && r.source === 'project')).toBe(
      true,
    );
    expect(rows.find((r) => r.id === 'project:p1')?.apply_status).toBe('written');
    expect(rows.find((r) => r.id === 'project:p1')?.target).toContain('phpuser');
    expect(rows.some((r) => r.id === 'project:p2')).toBe(false);
    expect(rows.some((r) => r.id === 'project:p3')).toBe(true);
    expect(rows.some((r) => r.serverName === 'solo.example.com')).toBe(true);
    // ysk-phpuser.conf claimed by project — not double-listed as artifact
    expect(rows.filter((r) => r.confPath?.endsWith('ysk-phpuser.conf'))).toHaveLength(1);
    expect(rows.some((r) => r.id === 'artifact:orphan.conf')).toBe(true);

    // Same ServerName as project → conflict on both project + artifact
    writeFileSync(
      join(sitesDir, 'stale-app.conf'),
      `ServerName app.example.com
DocumentRoot /var/www/stale
`,
      'utf8',
    );
    const withClash = listMergedApacheSites({
      dataDir: dir,
      projects: [
        {
          id: 'p1',
          name: 'PHP App',
          domain: 'app.example.com',
          runtime: 'php',
          linux_user: 'phpuser',
          home_dir: '/home/phpuser',
          doc_root: 'app/public',
        },
      ],
    });
    const clashRows = withClash.filter((r) => r.serverName === 'app.example.com');
    expect(clashRows.length).toBeGreaterThanOrEqual(2);
    expect(clashRows.every((r) => r.conflict === true)).toBe(true);
    expect(withClash.find((r) => r.id === 'artifact:stale-app.conf')?.owned).toBe(
      false,
    );
    expect(withClash.find((r) => r.id === 'project:p1')?.owned).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('reads conf file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ap-conf-'));
    const p = join(dir, 'a.conf');
    writeFileSync(p, '<VirtualHost *:80>\n</VirtualHost>\n');
    expect(readApacheSiteConf(p)).toContain('VirtualHost');
    expect(readApacheSiteConf('/no/such')).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});
