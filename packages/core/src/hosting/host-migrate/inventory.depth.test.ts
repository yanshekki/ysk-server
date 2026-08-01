import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  buildHostManifest,
  parsePasswdUidGid,
  summarizeManifest,
} from './inventory.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts?: {
  passwdOk?: boolean;
  bins?: string[];
}): HostExecutor {
  const bins = new Set(opts?.bins ?? ['rsync', 'ssh', 'mysqldump', 'pg_dump', 'redis-cli']);
  return {
    pathExists: () => false,
    isRoot: () => false,
    executeEnabled: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      if (argv[0] === 'getent') {
        if (opts?.passwdOk === false) return empty({ exitCode: 1 });
        return empty({
          exitCode: 0,
          stdout: 'ysks_demo:x:1201:1201::/home/x:/usr/sbin/nologin\n',
        });
      }
      if (argv[0] === 'bash' && String(argv[2] ?? '').includes('command -v')) {
        const cmd = String(argv[2] ?? '');
        for (const b of bins) {
          if (cmd.includes(b)) return empty({ stdout: 'ok\n' });
        }
        return empty({ stdout: '' });
      }
      return empty({ exitCode: 1 });
    },
  };
}

describe('inventory depth branches', () => {
  it('parsePasswdUidGid edge cases', () => {
    expect(parsePasswdUidGid('')).toBeUndefined();
    expect(parsePasswdUidGid('a:b')).toBeUndefined();
    expect(parsePasswdUidGid('a:b:x:y')).toBeUndefined();
    expect(parsePasswdUidGid('u:x:10:20:c:d:e')).toEqual({ uid: 10, gid: 20 });
  });

  it('buildHostManifest covers multi-runtime software + mail + db warnings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-inv-d-'));
    try {
      const store = new JsonStore(join(dir, 'ysk.json'));
      const now = new Date().toISOString();
      store.snapshot.projects = [
        {
          id: 'php1',
          name: 'PHP',
          runtime: 'php',
          home_dir: join(dir, 'homes', 'php1'),
          linux_user: 'ysks_demo',
          linux_group: 'ysks_demo',
          domain: 'php.local',
          bind_ip: '10.0.0.9',
          env: 'production',
          status: 'active',
          os_provisioned: false,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'py1',
          name: 'Py',
          runtime: 'python',
          home_dir: '/var/weird/home',
          linux_user: 'ysks_py',
          env: 'production',
          status: 'active',
          os_provisioned: false,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'go1',
          name: 'Go',
          runtime: 'go',
          home_dir: join(dir, 'missing-home'),
          linux_user: 'ysks_go',
          env: 'production',
          status: 'active',
          os_provisioned: false,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'rs1',
          name: 'Rust',
          runtime: 'rust',
          home_dir: join(dir, 'homes', 'rs1'),
          linux_user: 'ysks_rs',
          env: 'production',
          status: 'active',
          os_provisioned: false,
          created_at: now,
          updated_at: now,
        },
      ] as never;
      mkdirSync(join(dir, 'homes', 'php1'), { recursive: true });
      mkdirSync(join(dir, 'homes', 'rs1'), { recursive: true });

      store.snapshot.mysql_databases = [
        { id: 'm1', name: 'db1', username: 'u1' },
        { id: 'm2' }, // no name → warning
      ] as never;
      store.snapshot.postgres_databases = [
        { id: 'p1', name: 'pg1', username: 'u2' },
        { id: 'p2', database: '' },
      ] as never;
      store.snapshot.redis_instances = [{ id: 'r1', name: 'cache' }] as never;
      store.snapshot.email_domains = [{ id: 'e1', domain: 'mail.example.com' }] as never;
      store.snapshot.mailboxes = [
        {
          id: 'mb1',
          domain: 'mail.example.com',
          local: 'info',
        },
      ] as never;
      store.snapshot.ftp_accounts = [{ id: 'f1', username: 'ftp1' }] as never;
      store.snapshot.firewall_rules = [{ id: 'fw1', port: 22 }] as never;
      store.snapshot.dns_zones = [{ id: 'z1', zone: 'example.com' }] as never;
      store.snapshot.dns_records = [{ id: 'rec1', zone: 'example.com' }] as never;
      store.snapshot.certificates = [{ id: 'c1', domain: 'example.com' }] as never;
      store.snapshot.mysql_users = [{ id: 'mu1', username: 'u' }] as never;
      store.snapshot.postgres_users = [{ id: 'pu1', username: 'u' }] as never;
      store.persist();

      // missing tools for dump warnings
      const m = await buildHostManifest({
        db: store,
        dataDir: dir,
        host: mockHost({ bins: [] }),
        yskVersion: '9.9.9',
        exclusions: ['/tmp/skip'],
      });
      expect(m.projects.length).toBe(4);
      expect(m.databases.length).toBeGreaterThanOrEqual(2);
      expect(m.redis.length).toBe(1);
      expect(m.emailDomains.length).toBe(1);
      expect(m.mailboxes.length).toBe(1);
      expect(m.softwareNeeded.length).toBeGreaterThan(5);
      expect(m.warnings.length).toBeGreaterThan(3);
      expect(m.source.yskVersion).toBe('9.9.9');

      const sum = summarizeManifest(m);
      expect(sum.lines.length).toBeGreaterThan(3);
      expect(typeof sum.okToProceed).toBe('boolean');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('buildHostManifest getent fail and dump tools present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-inv-d2-'));
    try {
      const store = new JsonStore(join(dir, 'ysk.json'));
      store.snapshot.projects = [
        {
          id: 'n1',
          name: 'N',
          runtime: 'node',
          home_dir: join(dir, 'h'),
          linux_user: 'ysks_n',
          env: 'production',
          status: 'active',
          os_provisioned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as never;
      mkdirSync(join(dir, 'h'), { recursive: true });
      store.snapshot.mysql_databases = [{ name: 'x' }] as never;
      store.snapshot.postgres_databases = [{ name: 'y' }] as never;
      store.snapshot.redis_instances = [{ name: 'z' }] as never;
      store.persist();
      const m = await buildHostManifest({
        db: store,
        dataDir: dir,
        host: mockHost({ passwdOk: false, bins: ['rsync', 'ssh', 'mysqldump', 'pg_dump', 'redis-cli'] }),
      });
      expect(m.projects[0]?.uid).toBeUndefined();
      expect(m.softwareNeeded).toContain('nginx');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('buildHostManifest covers empty-name dbs, mailbox variants, getent throw, missing secrets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-inv-d3-'));
    try {
      // use a separate store file so ysk.json under dataDir can be absent
      const store = new JsonStore(join(dir, 'control.json'));
      store.snapshot.projects = [
        {
          id: 'empty-user',
          name: '',
          runtime: 'static',
          // default home path when missing
          linux_user: '',
          env: 'production',
          status: 'active',
          os_provisioned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as never;
      store.snapshot.mysql_databases = [{ id: 'mx', database: 'from_db_field' }] as never;
      store.snapshot.postgres_databases = [{ id: 'px', db_name: 'from_db_name' }] as never;
      store.snapshot.redis_instances = [{ name: 'only-name' }, {}] as never;
      store.snapshot.mailboxes = [
        {
          domain_name: 'alt.example.com',
          local_part: 'a',
        },
        {
          domain: 'alt.example.com',
          user: 'b',
        },
        {
          // empty domain/local — no maildir warning path
          domain: '',
          local: '',
        },
      ] as never;
      // create one real maildir
      const md = join(dir, 'email', 'alt.example.com', 'mailboxes', 'a', 'Maildir');
      mkdirSync(md, { recursive: true });
      store.persist();

      const throwingHost: HostExecutor = {
        ...mockHost({ bins: ['rsync'] }),
        runCommand: async (argv) => {
          if (argv[0] === 'getent') throw new Error('getent crash');
          if (argv[0] === 'bash' && String(argv[2] ?? '').includes('command -v')) {
            // only rsync present → ssh warning + throw path for some
            const cmd = String(argv[2] ?? '');
            if (cmd.includes('rsync')) return empty({ stdout: 'ok\n' });
            if (cmd.includes('ssh')) throw new Error('ssh probe boom');
            return empty({ stdout: '' });
          }
          return empty({ exitCode: 1 });
        },
      };

      const m = await buildHostManifest({
        db: store,
        dataDir: dir,
        host: throwingHost,
      });
      expect(m.projects[0]?.linux_user).toContain('ysk');
      expect(m.databases.some((d) => d.name === 'from_db_field')).toBe(true);
      expect(m.databases.some((d) => d.name === 'from_db_name')).toBe(true);
      expect(m.redis.length).toBeGreaterThanOrEqual(1);
      expect(m.mailboxes.length).toBe(3);
      expect(m.warnings.length).toBeGreaterThan(0);
      const sum = summarizeManifest(m);
      expect(sum.lines.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
