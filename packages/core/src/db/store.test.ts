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
});
