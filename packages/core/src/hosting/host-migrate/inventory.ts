import { tl } from '@ysk-server/shared';
/**
 * Build complete HostManifest from control-plane store + disk facts.
 * Read-only; no host mutation.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { arch, hostname, platform, release } from 'node:os';
import type {
  HostManifest,
  HostManifestDatabase,
  HostManifestMailbox,
  HostManifestProject,
  HostManifestRedis,
  MigrateDbEngine,
} from '@ysk-server/shared';
import type { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';
import { listSoftwareForFeature, type FeatureSoftwareKey } from '../software-catalog.js';

function sha256File(path: string): string | undefined {
  try {
    const buf = readFileSync(path);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return undefined;
  }
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

/**
 * Parse `getent passwd user` style line → uid/gid.
 */
export function parsePasswdUidGid(
  line: string,
): { uid: number; gid: number } | undefined {
  const parts = line.trim().split(':');
  if (parts.length < 4) return undefined;
  const uid = Number(parts[2]);
  const gid = Number(parts[3]);
  if (!Number.isFinite(uid) || !Number.isFinite(gid)) return undefined;
  return { uid, gid };
}

function globHomesOnDisk(): string[] {
  const root = '/home';
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root)
      .filter((n) => n.startsWith('ysk-server-'))
      .map((n) => join(root, n))
      .filter((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function resolveSoftwareNeeded(s: JsonStore['snapshot']): string[] {
  const features = new Set<FeatureSoftwareKey>(['nginx', 'git', 'node']);
  if ((s.email_domains?.length ?? 0) > 0 || (s.mailboxes?.length ?? 0) > 0) {
    features.add('email');
  }
  if ((s.mysql_databases?.length ?? 0) > 0 || (s.mysql_users?.length ?? 0) > 0) {
    features.add('mysql');
  }
  if (
    (s.postgres_databases?.length ?? 0) > 0 ||
    (s.postgres_users?.length ?? 0) > 0
  ) {
    features.add('postgres');
  }
  if ((s.redis_instances?.length ?? 0) > 0) features.add('redis');
  if ((s.ftp_accounts?.length ?? 0) > 0) features.add('ftp');
  if ((s.firewall_rules?.length ?? 0) > 0) features.add('firewall');
  if ((s.dns_zones?.length ?? 0) > 0 || (s.dns_records?.length ?? 0) > 0) {
    features.add('dns');
  }
  if ((s.certificates?.length ?? 0) > 0) features.add('ssl');

  for (const p of s.projects ?? []) {
    const rt = String(p.runtime ?? '');
    if (rt === 'php') features.add('php');
    if (rt === 'node') features.add('node');
    if (rt === 'python') features.add('python');
    if (rt === 'go') features.add('go');
    if (rt === 'rust') features.add('rust');
  }

  // fail2ban often paired with protection — include if any security settings
  features.add('fail2ban');

  const ids = new Set<string>();
  for (const f of features) {
    for (const spec of listSoftwareForFeature(f)) {
      ids.add(spec.id);
    }
  }
  return [...ids].sort();
}

function mapDbRow(
  engine: MigrateDbEngine,
  row: Record<string, unknown>,
): HostManifestDatabase {
  return {
    engine,
    id: str(row.id) || undefined,
    name: str(row.name || row.database || row.db_name),
    username: str(row.username || row.user) || undefined,
  };
}

/**
 * Build full-host migration inventory.
 */
export async function buildHostManifest(input: {
  db: JsonStore;
  dataDir: string;
  host: HostExecutor;
  /** Override ysk package version string */
  yskVersion?: string;
  exclusions?: string[];
}): Promise<HostManifest> {
  const dataDir = resolve(input.dataDir);
  const s = input.db.snapshot;
  const warnings: string[] = [];
  const createdAt = new Date().toISOString();

  // --- projects ---
  const projects: HostManifestProject[] = [];
  const homeSet = new Set<string>();

  for (const p of s.projects ?? []) {
    const home = str(p.home_dir) || join('/home', `ysk-server-${p.id}`);
    const homeExists = existsSync(home);
    homeSet.add(resolve(home));

    let uid: number | undefined;
    let gid: number | undefined;
    const user = str(p.linux_user);
    if (user) {
      try {
        const r = await input.host.runCommand(
          ['getent', 'passwd', user],
          { timeoutMs: 5_000, dryRun: false },
        );
        if (r.exitCode === 0 && r.stdout.trim()) {
          const ug = parsePasswdUidGid(r.stdout);
          if (ug) {
            uid = ug.uid;
            gid = ug.gid;
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (!homeExists) {
      warnings.push(tl('notes.auto.t0629', { v0: (p.id), v1: (home) }));
    }
    if (p.bind_ip) {
      warnings.push(
        tl('notes.auto.t0630', { v0: (p.id), v1: (p.bind_ip) }),
      );
    }
    if (!home.startsWith('/home/ysk-server-') && !home.startsWith(dataDir)) {
      warnings.push(tl('notes.auto.t0631', { v0: (p.id), v1: (home) }));
    }

    projects.push({
      id: str(p.id),
      name: str(p.name) || str(p.id),
      home_dir: home,
      linux_user: user || `ysks_unknown`,
      linux_group: str(p.linux_group) || undefined,
      runtime: str(p.runtime) || 'static',
      domain: str(p.domain) || undefined,
      uid,
      gid,
      homeExists,
      bind_ip: str(p.bind_ip) || undefined,
    });
  }

  // Disk homes not in store
  for (const diskHome of globHomesOnDisk()) {
    const abs = resolve(diskHome);
    if (!homeSet.has(abs)) {
      warnings.push(tl('notes.auto.t0632', { v0: (diskHome) }));
      homeSet.add(abs);
    }
  }

  // --- databases ---
  const databases: HostManifestDatabase[] = [];
  for (const row of s.mysql_databases ?? []) {
    const m = mapDbRow('mysql', row as Record<string, unknown>);
    if (m.name) databases.push(m);
    else warnings.push(tl('notes.auto.n0336'));
  }
  // MariaDB rows often share mysql_databases; keep engine mysql unless tagged
  for (const row of s.postgres_databases ?? []) {
    const m = mapDbRow('postgres', row as Record<string, unknown>);
    if (m.name) databases.push(m);
    else warnings.push(tl('notes.auto.n0385'));
  }

  const redis: HostManifestRedis[] = [];
  for (const row of s.redis_instances ?? []) {
    const r = row as Record<string, unknown>;
    redis.push({
      id: str(r.id) || str(r.name) || randomIdFallback(r),
      name: str(r.name) || undefined,
    });
  }

  // --- mail ---
  const emailDomains = (s.email_domains ?? []).map((d) => ({
    id: str((d as Record<string, unknown>).id),
    domain: str((d as Record<string, unknown>).domain),
  }));

  const mailboxes: HostManifestMailbox[] = [];
  for (const mb of s.mailboxes ?? []) {
    const m = mb as Record<string, unknown>;
    const domain = str(m.domain || m.domain_name);
    const local = str(m.local || m.local_part || m.user);
    const id = str(m.id) || `${local}@${domain}`;
    // Managed layout: dataDir/email/<domain>/mailboxes/<local>/Maildir
    const rel = join('email', domain, 'mailboxes', local, 'Maildir');
    const abs = join(dataDir, rel);
    const exists = existsSync(abs);
    if (!exists && domain && local) {
      warnings.push(tl('notes.auto.t0633', { v0: (rel) }));
    }
    mailboxes.push({
      id,
      domain,
      local,
      maildirRelPath: rel.replace(/\\/g, '/'),
      exists,
    });
  }

  // --- critical dataDir paths ---
  const dataDirCritical = [
    'ysk.json',
    'config.json',
    'secrets',
    'email',
    'nginx',
    'certs',
    'dns',
    'backups',
    'db-dumps',
    'files',
    'cron',
    'systemd',
  ];
  for (const rel of dataDirCritical) {
    if (!existsSync(join(dataDir, rel))) {
      // secrets/config may be missing on fresh — warn only for ysk.json
      if (rel === 'ysk.json') {
        warnings.push(tl('notes.auto.n0244'));
      }
    }
  }

  const secretsKey = join(dataDir, 'secrets', 'ssh', '.master.key');
  if (!existsSync(secretsKey) && !process.env.YSK_SECRETS_KEY) {
    warnings.push(
      tl('notes.auto.n0959'),
    );
  }

  const optionalEtc: string[] = [];
  if (existsSync('/etc/letsencrypt')) {
    optionalEtc.push('/etc/letsencrypt');
  }

  // Dump tools presence (for later package phase) — HostSoftwareProbe PATH
  const { binPresent } = await import('../software-probe/index.js');
  for (const bin of ['mysqldump', 'pg_dump', 'redis-cli', 'rsync', 'ssh']) {
    try {
      if (!(await binPresent(input.host, bin))) {
        if (bin === 'mysqldump' && databases.some((d) => d.engine === 'mysql')) {
          warnings.push(tl('notes.auto.n0543'));
        }
        if (bin === 'pg_dump' && databases.some((d) => d.engine === 'postgres')) {
          warnings.push(tl('notes.auto.n0544'));
        }
        if (bin === 'redis-cli' && redis.length > 0) {
          warnings.push(tl('notes.auto.n0545'));
        }
        if (bin === 'rsync' || bin === 'ssh') {
          warnings.push(tl('notes.auto.t0634', { v0: (bin) }));
        }
      }
    } catch {
      warnings.push(tl('notes.auto.t0635', { v0: (bin) }));
    }
  }

  const softwareNeeded = resolveSoftwareNeeded(s);

  const cutoverHostnames = new Set<string>();
  for (const p of projects) {
    if (p.domain) cutoverHostnames.add(p.domain);
  }
  for (const d of emailDomains) {
    if (d.domain) cutoverHostnames.add(d.domain);
  }

  const counts: Record<string, number> = {
    projects: projects.length,
    users: s.users?.length ?? 0,
    packages: s.packages?.length ?? 0,
    email_domains: emailDomains.length,
    mailboxes: mailboxes.length,
    email_aliases: s.email_aliases?.length ?? 0,
    mysql_databases: (s.mysql_databases ?? []).length,
    postgres_databases: (s.postgres_databases ?? []).length,
    redis_instances: redis.length,
    dns_zones: s.dns_zones?.length ?? 0,
    dns_records: s.dns_records?.length ?? 0,
    certificates: s.certificates?.length ?? 0,
    cron_jobs: s.cron_jobs?.length ?? 0,
    ftp_accounts: s.ftp_accounts?.length ?? 0,
    nginx_sites: s.nginx_sites?.length ?? 0,
    firewall_rules: s.firewall_rules?.length ?? 0,
    api_keys: s.api_keys?.length ?? 0,
    file_shares: s.file_shares?.length ?? 0,
    homes_on_disk: homeSet.size,
    software_needed: softwareNeeded.length,
    warnings: warnings.length,
  };

  const fingerprints: Record<string, string> = {};
  const yskJson = join(dataDir, 'ysk.json');
  const h1 = sha256File(yskJson);
  if (h1) fingerprints['dataDir/ysk.json'] = h1;
  fingerprints['counts'] = sha256Text(JSON.stringify(counts));
  fingerprints['projects'] = sha256Text(
    JSON.stringify(projects.map((p) => ({ id: p.id, home: p.home_dir }))),
  );
  fingerprints['databases'] = sha256Text(
    JSON.stringify(databases.map((d) => `${d.engine}:${d.name}`).sort()),
  );

  let osLabel = `${platform()} ${release()}`;
  try {
    const sys = await input.host.sysInfo();
    if (sys && typeof sys === 'object') {
      const h = str((sys as { hostname?: string }).hostname);
      if (h) {
        /* keep hostname from os.hostname below unless sys overrides */
      }
    }
  } catch {
    /* */
  }

  const homes = [...homeSet].sort();

  return {
    version: 1,
    createdAt,
    source: {
      hostname: hostname(),
      os: osLabel,
      arch: arch(),
      dataDir,
      yskVersion: input.yskVersion ?? '0.1.0',
      nodeVersion: process.version,
    },
    counts,
    projects,
    databases,
    redis,
    mailboxes,
    emailDomains: emailDomains.filter((d) => d.domain),
    softwareNeeded,
    paths: {
      dataDir,
      homes,
      optionalEtc,
      dataDirCritical,
    },
    fingerprints,
    warnings,
    exclusions: [...(input.exclusions ?? [])],
    cutoverHostnames: [...cutoverHostnames].sort(),
  };
}

function randomIdFallback(r: Record<string, unknown>): string {
  return `redis-${sha256Text(JSON.stringify(r)).slice(0, 12)}`;
}

/** Summarize manifest for CLI / UI cards */
export function summarizeManifest(m: HostManifest): {
  okToProceed: boolean;
  lines: string[];
} {
  const lines = [
    tl('notes.auto.t0636', { v0: (m.source.hostname), v1: (m.source.os) }),
    `dataDir ${m.source.dataDir}`,
    tl('notes.auto.t0637', { v0: (m.counts.projects), v1: (m.counts.mailboxes), v2: (m.databases.length), v3: (m.redis.length) }),
    tl('notes.auto.t0638', { v0: (m.softwareNeeded.length), v1: (m.paths.homes.length) }),
    tl('notes.auto.t0639', { v0: (m.cutoverHostnames.length) }),
  ];
  if (m.warnings.length) {
    lines.push(tl('notes.auto.t0640', { v0: (m.warnings.length) }));
  }
  const blocking = m.warnings.some(
    (w) => w.includes(tl('notes.auto.n1319')) || w.includes(tl('notes.auto.n1320')) || w.includes(tl('notes.auto.n1321')),
  );
  return { okToProceed: !blocking, lines };
}
