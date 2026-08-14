/**
 * Global panel search — pages (nav) + stored resources.
 * Designed for command-palette UX: ranked, kind-tagged, deep-link hrefs.
 */

import { tl } from 'ysk-server-shared';
import type { YskDatabase } from '../db/database.js';

export type SearchHit = {
  kind: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  /** Sort score (higher first); internal */
  score?: number;
};

/** Static page index — keep in sync with web FEATURE_SECTIONS paths. */
const PANEL_PAGES: Array<{
  kind: 'page';
  id: string;
  title: string;
  href: string;
  /** Extra tokens for matching (EN keywords) */
  aliases: string[];
  section: string;
}> = [
  { kind: 'page', id: 'dashboard', title: 'Dashboard', href: '/', aliases: ['home', 'overview'], section: 'overview' },
  { kind: 'page', id: 'projects', title: 'Projects', href: '/projects', aliases: ['sites', 'apps'], section: 'sites' },
  { kind: 'page', id: 'email', title: 'Email', href: '/email', aliases: ['mail', 'smtp', 'imap'], section: 'mail' },
  { kind: 'page', id: 'files', title: 'Files', href: '/files', aliases: ['file manager', 'share'], section: 'files' },
  { kind: 'page', id: 'publicFiles', title: 'Public files', href: '/files/public', aliases: ['public'], section: 'files' },
  { kind: 'page', id: 'ftp', title: 'FTP', href: '/ftp', aliases: ['ftps', 'vsftpd'], section: 'files' },
  { kind: 'page', id: 'btTracker', title: 'BT Tracker', href: '/bt-tracker', aliases: ['bittorrent', 'webtorrent', 'torrent', 'magnet', 'tracker'], section: 'files' },
  { kind: 'page', id: 'mysql', title: 'MySQL', href: '/databases/mysql', aliases: ['database', 'sql'], section: 'databases' },
  { kind: 'page', id: 'mysqlService', title: 'MySQL service', href: '/databases/mysql/service', aliases: ['mysql engine'], section: 'databases' },
  { kind: 'page', id: 'mariadb', title: 'MariaDB', href: '/databases/mariadb', aliases: ['database'], section: 'databases' },
  { kind: 'page', id: 'mariadbService', title: 'MariaDB service', href: '/databases/mariadb/service', aliases: [], section: 'databases' },
  { kind: 'page', id: 'postgres', title: 'PostgreSQL', href: '/databases/postgres', aliases: ['postgres', 'pg', 'database'], section: 'databases' },
  { kind: 'page', id: 'postgresService', title: 'PostgreSQL service', href: '/databases/postgres/service', aliases: [], section: 'databases' },
  { kind: 'page', id: 'redis', title: 'Redis', href: '/databases/redis', aliases: ['cache'], section: 'databases' },
  { kind: 'page', id: 'redisService', title: 'Redis service', href: '/databases/redis/service', aliases: [], section: 'databases' },
  { kind: 'page', id: 'dns', title: 'DNS', href: '/dns', aliases: ['zone', 'nameserver'], section: 'dnsSsl' },
  { kind: 'page', id: 'cdn', title: 'CDN', href: '/cdn', aliases: ['fleet', 'edge'], section: 'dnsSsl' },
  { kind: 'page', id: 'ssl', title: 'SSL', href: '/ssl', aliases: ['tls', 'certificate', 'letsencrypt', 'acme'], section: 'dnsSsl' },
  { kind: 'page', id: 'nginx', title: 'Nginx', href: '/nginx', aliases: ['proxy', 'vhost'], section: 'dnsSsl' },
  { kind: 'page', id: 'apache', title: 'Apache', href: '/apache', aliases: ['httpd'], section: 'dnsSsl' },
  { kind: 'page', id: 'node', title: 'Node.js', href: '/runtimes/node', aliases: ['runtime', 'nodejs'], section: 'runtimes' },
  { kind: 'page', id: 'php', title: 'PHP', href: '/runtimes/php', aliases: ['runtime'], section: 'runtimes' },
  { kind: 'page', id: 'python', title: 'Python', href: '/runtimes/python', aliases: ['runtime'], section: 'runtimes' },
  { kind: 'page', id: 'go', title: 'Go', href: '/runtimes/go', aliases: ['golang', 'runtime'], section: 'runtimes' },
  { kind: 'page', id: 'rust', title: 'Rust', href: '/runtimes/rust', aliases: ['runtime'], section: 'runtimes' },
  { kind: 'page', id: 'java', title: 'Java', href: '/runtimes/java', aliases: ['runtime', 'jvm'], section: 'runtimes' },
  { kind: 'page', id: 'kotlin', title: 'Kotlin', href: '/runtimes/kotlin', aliases: ['runtime'], section: 'runtimes' },
  { kind: 'page', id: 'bun', title: 'Bun', href: '/runtimes/bun', aliases: ['runtime'], section: 'runtimes' },
  { kind: 'page', id: 'protection', title: 'Protection', href: '/protection', aliases: ['defense', 'ddos', 'firewall', 'ufw', 'fail2ban'], section: 'security' },
  { kind: 'page', id: 'security', title: 'Security', href: '/security', aliases: ['2fa', 'ssh', 'totp', 'password'], section: 'security' },
  { kind: 'page', id: 'vpn', title: 'VPN', href: '/vpn', aliases: ['wireguard', 'openvpn'], section: 'security' },
  { kind: 'page', id: 'vnc', title: 'VNC', href: '/vnc', aliases: ['desktop', 'remote'], section: 'security' },
  { kind: 'page', id: 'users', title: 'Users', href: '/users', aliases: ['rbac', 'admin', 'roles'], section: 'system' },
  { kind: 'page', id: 'services', title: 'Services', href: '/services', aliases: ['systemd', 'units'], section: 'system' },
  { kind: 'page', id: 'metrics', title: 'Metrics', href: '/metrics', aliases: ['cpu', 'memory', 'monitor'], section: 'system' },
  { kind: 'page', id: 'network', title: 'Network', href: '/network', aliases: ['ip', 'interface', 'exposure'], section: 'system' },
  { kind: 'page', id: 'hostBrowse', title: 'Host browse', href: '/browse', aliases: ['filesystem', 'host files'], section: 'system' },
  { kind: 'page', id: 'logs', title: 'Logs', href: '/logs', aliases: ['journal', 'syslog'], section: 'system' },
  { kind: 'page', id: 'terminal', title: 'Terminal', href: '/terminal', aliases: ['shell', 'ssh', 'console'], section: 'system' },
  { kind: 'page', id: 'cron', title: 'Cron', href: '/cron', aliases: ['schedule', 'jobs'], section: 'system' },
  { kind: 'page', id: 'backups', title: 'Backups', href: '/backups', aliases: ['backup', 'restore'], section: 'system' },
  { kind: 'page', id: 'migrate', title: 'Migrate', href: '/system/migrate', aliases: ['migration', 'import'], section: 'system' },
  { kind: 'page', id: 'updates', title: 'Updates', href: '/updates', aliases: ['upgrade', 'packages'], section: 'system' },
  { kind: 'page', id: 'systemd', title: 'Systemd unit', href: '/system/unit', aliases: ['unit install'], section: 'system' },
  { kind: 'page', id: 'readiness', title: 'Readiness', href: '/system/readiness', aliases: ['health', 'gate'], section: 'system' },
  { kind: 'page', id: 'systemIndex', title: 'System', href: '/system', aliases: ['settings', 'panel'], section: 'system' },
  { kind: 'page', id: 'support', title: 'Support', href: '/support', aliases: ['donate', 'creator', 'ysk', 'help', 'contact'], section: 'system' },
];

function safeTl(key: string): string {
  try {
    const s = tl(key);
    if (!s || s === key || s.startsWith('nav.')) return '';
    return s;
  } catch {
    return '';
  }
}

function matchScore(query: string, ...fields: string[]): number {
  const q = query.toLowerCase();
  if (!q) return 0;
  let best = 0;
  for (const raw of fields) {
    const f = String(raw || '').toLowerCase();
    if (!f) continue;
    if (f === q) best = Math.max(best, 100);
    else if (f.startsWith(q)) best = Math.max(best, 80);
    else if (f.includes(q)) best = Math.max(best, 50);
    else {
      // token match
      for (const tok of f.split(/[\s./:_-]+/)) {
        if (tok === q) best = Math.max(best, 70);
        else if (tok.startsWith(q)) best = Math.max(best, 60);
      }
    }
  }
  return best;
}

function pushHit(hits: SearchHit[], hit: SearchHit, score: number, limit: number) {
  if (score <= 0) return;
  if (hits.length >= limit * 3) return; // collect extra then sort/slice
  hits.push({ ...hit, score });
}

function arr(snap: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const v = snap[key];
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

export function globalSearch(db: YskDatabase, q: string, limit = 40): SearchHit[] {
  const query = q.trim().toLowerCase();
  if (query.length < 1) return [];
  const hits: SearchHit[] = [];
  const snap = db.snapshot as unknown as Record<string, unknown>;

  // —— Pages (always available) ——
  for (const p of PANEL_PAGES) {
    const locTitle = safeTl(`nav.${p.id}`);
    const locSection = safeTl(`nav.sections.${p.section}`);
    const localized = [locTitle, locSection].filter(Boolean);
    const score = matchScore(query, p.title, p.id, p.section, ...p.aliases, ...localized);
    // Prefer pages slightly when score ties resources later
    pushHit(
      hits,
      {
        kind: 'page',
        id: p.id,
        title: localized[0] && localized[0] !== p.title ? locTitle : p.title,
        subtitle: locSection.startsWith('nav.') ? p.section : locSection,
        href: p.href,
      },
      score > 0 ? score + 5 : 0,
      limit,
    );
  }

  // —— Projects ——
  for (const p of arr(snap, 'projects')) {
    const name = String(p.name ?? '');
    const domain = String(p.domain ?? '');
    const id = String(p.id ?? '');
    const linux = String(p.linux_user ?? '');
    const score = matchScore(query, name, domain, id, linux);
    pushHit(
      hits,
      {
        kind: 'project',
        id,
        title: name || id,
        subtitle: domain || undefined,
        href: `/projects/${encodeURIComponent(id)}`,
      },
      score,
      limit,
    );
  }

  // —— Email domains + mailboxes ——
  for (const e of arr(snap, 'email_domains')) {
    const domain = String(e.domain ?? '');
    const id = String(e.id ?? '');
    const score = matchScore(query, domain, id);
    pushHit(
      hits,
      {
        kind: 'email',
        id,
        title: domain || id,
        subtitle: String(e.server_ip ?? e.serverIp ?? '') || undefined,
        href: id ? `/email/domains/${encodeURIComponent(id)}` : '/email',
      },
      score,
      limit,
    );
  }
  for (const m of arr(snap, 'mailboxes')) {
    const local = String(m.local_part ?? m.localPart ?? m.address ?? '');
    const domain = String(m.domain ?? '');
    const id = String(m.id ?? '');
    const addr = local.includes('@') ? local : domain ? `${local}@${domain}` : local;
    const score = matchScore(query, addr, local, domain, id);
    pushHit(
      hits,
      {
        kind: 'mailbox',
        id: id || addr,
        title: addr || id,
        subtitle: domain || undefined,
        href: '/email',
      },
      score,
      limit,
    );
  }

  // —— DNS zones ——
  for (const z of arr(snap, 'dns_zones')) {
    const zone = String(z.zone ?? z.name ?? '');
    const id = String(z.id ?? '');
    const score = matchScore(query, zone, id);
    pushHit(
      hits,
      {
        kind: 'dns',
        id: id || zone,
        title: zone || id,
        subtitle: String(z.serverIp ?? z.server_ip ?? '') || undefined,
        href: '/dns',
      },
      score,
      limit,
    );
  }

  // —— SSL certificates ——
  for (const c of arr(snap, 'certificates')) {
    const domain = String(c.domain ?? '');
    const id = String(c.id ?? '');
    const score = matchScore(query, domain, id, String(c.status ?? ''));
    pushHit(
      hits,
      {
        kind: 'ssl',
        id: id || domain,
        title: domain || id,
        subtitle: String(c.status ?? '') || undefined,
        href: '/ssl',
      },
      score,
      limit,
    );
  }

  // —— Nginx sites ——
  for (const s of arr(snap, 'nginx_sites')) {
    const name = String(s.name ?? s.server_name ?? s.domain ?? '');
    const id = String(s.id ?? name);
    const score = matchScore(query, name, id, String(s.domain ?? ''));
    pushHit(
      hits,
      {
        kind: 'nginx',
        id,
        title: name || id,
        subtitle: String(s.domain ?? '') || undefined,
        href: '/nginx',
      },
      score,
      limit,
    );
  }

  // —— Users ——
  for (const u of arr(snap, 'users')) {
    const username = String(u.username ?? '');
    const id = String(u.id ?? '');
    const roles = Array.isArray(u.roles) ? (u.roles as string[]).join(',') : '';
    const score = matchScore(query, username, id, roles);
    pushHit(
      hits,
      {
        kind: 'user',
        id: id || username,
        title: username || id,
        subtitle: roles || undefined,
        href: '/users',
      },
      score,
      limit,
    );
  }

  // —— FTP ——
  for (const a of arr(snap, 'ftp_accounts')) {
    const username = String(a.username ?? '');
    const id = String(a.id ?? '');
    const home = String(a.homePath ?? a.home_path ?? '');
    const score = matchScore(query, username, id, home);
    pushHit(
      hits,
      {
        kind: 'ftp',
        id: id || username,
        title: username || id,
        subtitle: home || undefined,
        href: '/ftp',
      },
      score,
      limit,
    );
  }

  // —— File shares ——
  for (const s of arr(snap, 'file_shares')) {
    const path = String(s.path ?? '');
    const id = String(s.id ?? '');
    const token = String(s.token ?? '');
    const score = matchScore(query, path, id, token);
    pushHit(
      hits,
      {
        kind: 'share',
        id: id || token,
        title: path.split('/').pop() || path || id,
        subtitle: path || undefined,
        href: '/files?tab=shares',
      },
      score,
      limit,
    );
  }

  // —— Cron ——
  for (const j of arr(snap, 'cron_jobs')) {
    const name = String(j.name ?? j.id ?? '');
    const id = String(j.id ?? name);
    const expr = String(j.schedule ?? j.expr ?? j.cron ?? '');
    const score = matchScore(query, name, id, expr, String(j.command ?? ''));
    pushHit(
      hits,
      {
        kind: 'cron',
        id,
        title: name || id,
        subtitle: expr || undefined,
        href: '/cron',
      },
      score,
      limit,
    );
  }

  // —— MySQL / Postgres DBs (names only) ——
  for (const d of arr(snap, 'mysql_databases')) {
    const name = String(d.name ?? d.database ?? '');
    const id = String(d.id ?? name);
    const score = matchScore(query, name, id);
    pushHit(
      hits,
      {
        kind: 'mysql',
        id,
        title: name || id,
        href: '/databases/mysql',
      },
      score,
      limit,
    );
  }
  for (const d of arr(snap, 'postgres_databases')) {
    const name = String(d.name ?? d.database ?? '');
    const id = String(d.id ?? name);
    const score = matchScore(query, name, id);
    pushHit(
      hits,
      {
        kind: 'postgres',
        id,
        title: name || id,
        href: '/databases/postgres',
      },
      score,
      limit,
    );
  }

  // —— Redis instances ——
  for (const r of arr(snap, 'redis_instances')) {
    const name = String(r.name ?? r.id ?? '');
    const id = String(r.id ?? name);
    const score = matchScore(query, name, id, String(r.port ?? ''));
    pushHit(
      hits,
      {
        kind: 'redis',
        id,
        title: name || id,
        subtitle: r.port != null ? `port ${r.port}` : undefined,
        href: '/databases/redis',
      },
      score,
      limit,
    );
  }

  hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.title.localeCompare(b.title));
  return hits.slice(0, limit).map(({ score: _s, ...rest }) => rest);
}

/** Exported for tests / UI quick-links without query */
export function listSearchablePages(): Array<{ id: string; title: string; href: string; section: string }> {
  return PANEL_PAGES.map((p) => ({
    id: p.id,
    title: p.title,
    href: p.href,
    section: p.section,
  }));
}
