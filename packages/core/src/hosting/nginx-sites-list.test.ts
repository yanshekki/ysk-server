import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { createResource } from './managed-resources.js';
import { listMergedNginxSites, readNginxSiteConf } from './nginx-sites-list.js';

describe('listMergedNginxSites', () => {
  it('merges project + standalone rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-list-'));
    const db = openDatabase(join(dir, 'ysk.json'));
    createResource(db, 'nginx_sites', {
      serverName: 'solo.example.com',
      kind: 'proxy',
      upstream: 'http://127.0.0.1:3000',
      ssl: false,
    });
    const rows = listMergedNginxSites({
      db,
      projects: [
        {
          id: 'p1',
          name: 'App',
          domain: 'app.example.com',
          runtime: 'node',
          port: 3001,
          nginxConfigPath: '/tmp/x.conf',
        },
        { id: 'p2', name: 'NoDomain', runtime: 'node' },
      ],
    });
    expect(rows.some((r) => r.id === 'project:p1' && r.source === 'project')).toBe(
      true,
    );
    expect(rows.some((r) => r.serverName === 'solo.example.com')).toBe(true);
    expect(rows.some((r) => r.id === 'project:p2')).toBe(false);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('uses server_name from conf when project domain is empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-sn-'));
    const db = openDatabase(join(dir, 'ysk.json'));
    const conf = join(dir, 'idm.conf');
    writeFileSync(conf, 'server {\n  server_name localhost;\n}\n');
    const rows = listMergedNginxSites({
      db,
      projects: [
        {
          id: 'idm',
          name: 'idm',
          domain: '',
          runtime: 'php',
          nginxConfigPath: conf,
        },
      ],
    });
    expect(rows.find((r) => r.id === 'project:idm')?.serverName).toBe('localhost');
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads conf file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-conf-'));
    const p = join(dir, 'a.conf');
    writeFileSync(p, 'server {}\n');
    expect(readNginxSiteConf(p)).toContain('server');
    expect(readNginxSiteConf('/no/such')).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});
