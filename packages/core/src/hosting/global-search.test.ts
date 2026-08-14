import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { globalSearch, listSearchablePages } from './global-search.js';
import type { YskDatabase } from '../db/database.js';

describe('globalSearch', () => {
  it('finds projects users email ftp ssl dns pages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-search-'));
    try {
      const store = new JsonStore(join(dir, 'db.json'));
      store.snapshot.projects = [
        {
          id: 'p1',
          name: 'AcmeApp',
          domain: 'acme.test',
          linux_user: 'ysks_acme',
          linux_group: 'g',
          home_dir: '/h',
          runtime: 'node',
          env: 'production',
          status: 'active',
          os_provisioned: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as never;
      store.snapshot.users = [
        {
          id: 'u1',
          username: 'alice',
          password_hash: 'x',
          password_salt: 'y',
          roles: ['admin'],
          locale: 'zh-HK',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      store.snapshot.email_domains = [{ id: 'e1', domain: 'mail.acme.test' }] as never;
      store.snapshot.ftp_accounts = [{ id: 'f1', username: 'ftp_acme', homePath: '/h' }] as never;
      store.snapshot.certificates = [{ id: 'c1', domain: 'acme.test', status: 'active' }] as never;
      (store.snapshot as { dns_zones?: unknown[] }).dns_zones = [
        { id: 'z1', zone: 'acme.test' },
      ];
      store.snapshot.file_shares = [
        { id: 's1', path: '/public/acme-video.mp4', token: 'tok1' },
      ] as never;
      store.snapshot.nginx_sites = [{ id: 'n1', name: 'acme-site', domain: 'acme.test' }] as never;
      store.persist();
      const db = store as unknown as YskDatabase;
      expect(globalSearch(db, '')).toEqual([]);

      const hits = globalSearch(db, 'acme');
      expect(hits.some((h) => h.kind === 'project')).toBe(true);
      expect(hits.some((h) => h.kind === 'email')).toBe(true);
      expect(hits.some((h) => h.kind === 'ssl')).toBe(true);
      expect(hits.some((h) => h.kind === 'dns')).toBe(true);
      expect(hits.some((h) => h.kind === 'ftp')).toBe(true);
      expect(hits.some((h) => h.kind === 'nginx')).toBe(true);
      expect(hits.some((h) => h.kind === 'share')).toBe(true);

      expect(globalSearch(db, 'alice').some((h) => h.kind === 'user')).toBe(true);

      // Page index: BT tracker aliases
      const bt = globalSearch(db, 'webtorrent');
      expect(bt.some((h) => h.kind === 'page' && h.href === '/bt-tracker')).toBe(true);

      const sslPage = globalSearch(db, 'certificate');
      expect(sslPage.some((h) => h.kind === 'page' && h.href === '/ssl')).toBe(true);

      // Ranking: exact page title high
      const projects = globalSearch(db, 'projects');
      expect(projects[0]?.kind).toBe('page');
      expect(projects[0]?.href).toBe('/projects');

      const backupsZh = globalSearch(db, '備份');
      expect(backupsZh.some((h) => h.kind === 'page' && h.href === '/backups')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists searchable pages catalog', () => {
    const pages = listSearchablePages();
    expect(pages.some((p) => p.href === '/bt-tracker')).toBe(true);
    expect(pages.length).toBeGreaterThan(20);
  });
});
