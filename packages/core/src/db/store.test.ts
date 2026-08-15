import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from './store.js';

describe('JsonStore', () => {
  it('creates empty store file and reloads data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-jsonstore-'));
    const path = join(dir, 'store.json');
    const s1 = new JsonStore(path);
    expect(existsSync(path)).toBe(true);
    s1.snapshot.users.push({
      id: 'u1',
      username: 'admin',
      password_hash: 'h',
      password_salt: 's',
      roles: ['admin'],
      locale: 'en',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    s1.snapshot.settings.theme = 'dark';
    s1.persist();
    s1.close();

    const s2 = new JsonStore(path);
    expect(s2.snapshot.users).toHaveLength(1);
    expect(s2.snapshot.users[0]!.username).toBe('admin');
    expect(s2.snapshot.settings.theme).toBe('dark');
    expect(Array.isArray(s2.snapshot.projects)).toBe(true);
    s2.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('atomic write leaves valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-jsonstore-'));
    const path = join(dir, 'store.json');
    const s = new JsonStore(path);
    s.snapshot.settings.k = 'v';
    s.persist();
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    expect(raw.settings.k).toBe('v');
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reloads sparse JSON and coalesces null/missing collections', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-jsonstore-sparse-'));
    const path = join(dir, 'store.json');
    // Only partial keys — every ?? fallback in constructor should fire
    writeFileSync(
      path,
      JSON.stringify({
        version: null,
        users: null,
        packages: null,
        sessions: null,
        projects: null,
        backup_exclusions: null,
        approvals: null,
        audit_events: null,
        settings: null,
        agent_sessions: null,
        agent_messages: null,
        email_domains: null,
        ai_tasks: null,
        playbook_runs: null,
        update_jobs: null,
        dns_zones: null,
        firewall_rules: null,
        certificates: null,
        mailboxes: null,
        email_aliases: null,
        cron_jobs: null,
        nginx_sites: null,
        ftp_accounts: null,
        mysql_databases: null,
        mysql_users: null,
        postgres_databases: null,
        postgres_users: null,
        redis_instances: null,
        dns_records: null,
        file_shares: null,
        file_favorites: null,
        api_keys: null,
      }),
      'utf8',
    );
    const s = new JsonStore(path);
    expect(Array.isArray(s.snapshot.users)).toBe(true);
    expect(Array.isArray(s.snapshot.packages)).toBe(true);
    expect(Array.isArray(s.snapshot.sessions)).toBe(true);
    expect(Array.isArray(s.snapshot.projects)).toBe(true);
    expect(Array.isArray(s.snapshot.backup_exclusions)).toBe(true);
    expect(Array.isArray(s.snapshot.approvals)).toBe(true);
    expect(Array.isArray(s.snapshot.audit_events)).toBe(true);
    expect(s.snapshot.settings).toEqual({});
    expect(Array.isArray(s.snapshot.agent_sessions)).toBe(true);
    expect(Array.isArray(s.snapshot.agent_messages)).toBe(true);
    expect(Array.isArray(s.snapshot.email_domains)).toBe(true);
    expect(Array.isArray(s.snapshot.ai_tasks)).toBe(true);
    expect(Array.isArray(s.snapshot.playbook_runs)).toBe(true);
    expect(Array.isArray(s.snapshot.update_jobs)).toBe(true);
    expect(Array.isArray(s.snapshot.dns_zones)).toBe(true);
    expect(Array.isArray(s.snapshot.firewall_rules)).toBe(true);
    expect(Array.isArray(s.snapshot.certificates)).toBe(true);
    expect(Array.isArray(s.snapshot.mailboxes)).toBe(true);
    expect(Array.isArray(s.snapshot.email_aliases)).toBe(true);
    expect(Array.isArray(s.snapshot.cron_jobs)).toBe(true);
    expect(Array.isArray(s.snapshot.nginx_sites)).toBe(true);
    expect(Array.isArray(s.snapshot.ftp_accounts)).toBe(true);
    expect(Array.isArray(s.snapshot.mysql_databases)).toBe(true);
    expect(Array.isArray(s.snapshot.mysql_users)).toBe(true);
    expect(Array.isArray(s.snapshot.postgres_databases)).toBe(true);
    expect(Array.isArray(s.snapshot.postgres_users)).toBe(true);
    expect(Array.isArray(s.snapshot.redis_instances)).toBe(true);
    expect(Array.isArray(s.snapshot.dns_records)).toBe(true);
    expect(Array.isArray(s.snapshot.file_shares)).toBe(true);
    expect(Array.isArray(s.snapshot.file_favorites)).toBe(true);
    expect(Array.isArray(s.snapshot.api_keys)).toBe(true);
    expect(typeof s.snapshot.version).toBe('number');
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not drop another process project when persisting settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-jsonstore-race-'));
    const path = join(dir, 'ysk.json');
    const serve = new JsonStore(path);
    serve.snapshot.settings.theme = 'dark';
    serve.persist();

    const cli = new JsonStore(path);
    cli.snapshot.projects.push({
      id: 'p-cli',
      name: 'qa35-php',
      runtime: 'php',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as (typeof cli.snapshot.projects)[number]);
    cli.persist();
    cli.close();

    serve.snapshot.settings.log_hint = '1';
    serve.persist();
    expect(serve.snapshot.projects.map((p) => p.id)).toContain('p-cli');
    expect(serve.snapshot.settings.theme).toBe('dark');
    expect(serve.snapshot.settings.log_hint).toBe('1');

    const again = new JsonStore(path);
    expect(again.snapshot.projects.map((p) => p.id)).toContain('p-cli');
    again.close();
    serve.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not resurrect a project another process deleted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-jsonstore-del-'));
    const path = join(dir, 'ysk.json');
    const serve = new JsonStore(path);
    const created = new Date().toISOString();
    serve.snapshot.projects.push({
      id: 'p-gone',
      name: 'qa36tmp',
      runtime: 'node',
      created_at: created,
      updated_at: created,
    } as (typeof serve.snapshot.projects)[number]);
    serve.persist();

    const cli = new JsonStore(path);
    cli.snapshot.projects = cli.snapshot.projects.filter((p) => p.id !== 'p-gone');
    cli.persist();
    cli.close();

    serve.snapshot.settings.log_hint = '1';
    serve.persist();
    expect(serve.snapshot.projects.map((p) => p.id)).not.toContain('p-gone');

    const again = new JsonStore(path);
    expect(again.snapshot.projects.map((p) => p.id)).not.toContain('p-gone');
    again.close();
    serve.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not clobber totp when a stale process persists settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-jsonstore-totp-'));
    const path = join(dir, 'ysk.json');
    const serve = new JsonStore(path);
    const created = '2026-01-01T00:00:00.000Z';
    serve.snapshot.users.push({
      id: 'u-admin',
      username: 'admin',
      password_hash: 'h0',
      password_salt: 's0',
      roles: ['admin'],
      locale: 'en',
      created_at: created,
      updated_at: created,
    });
    serve.persist();

    const enroll = new JsonStore(path);
    const u = enroll.snapshot.users.find((x) => x.id === 'u-admin');
    expect(u).toBeDefined();
    u!.totp_secret = 'yskenc:v1:secret';
    u!.totp_enabled = true;
    u!.totp_recovery_hashes = ['hash-a', 'hash-b'];
    u!.updated_at = '2026-01-02T00:00:00.000Z';
    enroll.persist();
    enroll.close();

    serve.snapshot.settings.log_hint = '1';
    serve.persist();
    const kept = serve.snapshot.users.find((x) => x.id === 'u-admin');
    expect(kept?.totp_enabled).toBe(true);
    expect(kept?.totp_secret).toBe('yskenc:v1:secret');
    expect(kept?.totp_recovery_hashes).toEqual(['hash-a', 'hash-b']);

    const again = new JsonStore(path);
    const row = again.snapshot.users.find((x) => x.id === 'u-admin');
    expect(row?.totp_enabled).toBe(true);
    expect(row?.totp_secret).toBe('yskenc:v1:secret');
    again.close();
    serve.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps totp from disk when this process only changes the password', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-jsonstore-totp-pw-'));
    const path = join(dir, 'ysk.json');
    const serve = new JsonStore(path);
    const created = '2026-01-01T00:00:00.000Z';
    serve.snapshot.users.push({
      id: 'u-admin',
      username: 'admin',
      password_hash: 'h0',
      password_salt: 's0',
      roles: ['admin'],
      locale: 'en',
      created_at: created,
      updated_at: created,
    });
    serve.persist();

    const enroll = new JsonStore(path);
    const eu = enroll.snapshot.users.find((x) => x.id === 'u-admin')!;
    eu.totp_secret = 'yskenc:v1:secret';
    eu.totp_enabled = true;
    eu.updated_at = '2026-01-02T00:00:00.000Z';
    enroll.persist();
    enroll.close();

    const su = serve.snapshot.users.find((x) => x.id === 'u-admin')!;
    su.password_hash = 'h1';
    su.password_salt = 's1';
    su.updated_at = '2026-01-03T00:00:00.000Z';
    serve.persist();
    const merged = serve.snapshot.users.find((x) => x.id === 'u-admin')!;
    expect(merged.totp_enabled).toBe(true);
    expect(merged.totp_secret).toBe('yskenc:v1:secret');
    expect(merged.password_hash).toBe('h1');

    const again = new JsonStore(path);
    const row = again.snapshot.users.find((x) => x.id === 'u-admin')!;
    expect(row.totp_enabled).toBe(true);
    expect(row.totp_secret).toBe('yskenc:v1:secret');
    expect(row.password_hash).toBe('h1');
    again.close();
    serve.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not re-enable WebDAV when a stale process persists theme', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-jsonstore-webdav-'));
    const path = join(dir, 'ysk.json');
    const serve = new JsonStore(path);
    serve.snapshot.settings.webdav_settings = JSON.stringify({
      enabled: true,
      mountPath: '/webdav',
      tokenHash: 'abc',
      tokenId: 'tok1',
    });
    serve.persist();

    const other = new JsonStore(path);
    other.snapshot.settings.webdav_settings = JSON.stringify({
      enabled: false,
      mountPath: '/webdav',
    });
    other.persist();
    other.close();

    serve.snapshot.settings.theme = 'dark';
    serve.persist();
    const parsed = JSON.parse(serve.snapshot.settings.webdav_settings ?? '{}') as {
      enabled?: boolean;
    };
    expect(parsed.enabled).toBe(false);

    const again = new JsonStore(path);
    expect(JSON.parse(again.snapshot.settings.webdav_settings ?? '{}').enabled).toBe(false);
    again.close();
    serve.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
