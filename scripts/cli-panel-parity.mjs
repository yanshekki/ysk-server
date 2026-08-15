#!/usr/bin/env node
/**
 * Panel ↔ CLI parity inventory (C0).
 * Reads nav FEATURE_SECTIONS + cli.ts CLI_COMMANDS + known mutation map.
 * Exit 0 always unless --strict and missing required CLI for a gap row.
 *
 * Usage:
 *   node scripts/cli-panel-parity.mjs
 *   node scripts/cli-panel-parity.mjs --json
 *   node scripts/cli-panel-parity.mjs --strict
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsonOut = process.argv.includes('--json');
const strict = process.argv.includes('--strict');

function read(p) {
  return readFileSync(join(root, p), 'utf8');
}

/** Extract string array from `const CLI_COMMANDS = [ ... ]` */
function parseCliCommands(src) {
  const m = src.match(/const CLI_COMMANDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([a-z0-9-]+)['"]/g)].map((x) => x[1]);
}

/** Extract top-level command handlers: if (command === 'x') */
function parseCommandHandlers(src) {
  return [
    ...new Set(
      [...src.matchAll(/if\s*\(\s*command\s*===\s*['"]([a-z0-9-]+)['"]\s*\)/g)].map(
        (x) => x[1],
      ),
    ),
  ].sort();
}

/** Parse FEATURE_SECTIONS items: key + to */
function parseNavFeatures(src) {
  const items = [];
  const re = /\{\s*to:\s*['"]([^'"]+)['"]\s*,\s*key:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    items.push({ to: m[1], key: m[2] });
  }
  return items;
}

/**
 * Expected CLI top-level (or first token) per panel nav key.
 * null = intentional panel-only or covered by another command.
 */
const NAV_TO_CLI = {
  dashboard: ['health', 'readiness', 'host', 'notifications'],
  projects: ['projects'],
  email: ['email'],
  files: ['files'],
  publicFiles: ['hosting', 'files'],
  ftp: ['hosting', 'ftp'],
  btTracker: ['bt-tracker', 'files'],
  mysql: ['hosting', 'db'],
  mysqlService: ['services', 'db', 'hosting'],
  mariadb: ['hosting', 'db'],
  mariadbService: ['services', 'db', 'hosting'],
  postgres: ['hosting', 'db'],
  postgresService: ['services', 'db', 'hosting'],
  redis: ['hosting', 'redis', 'db'],
  redisService: ['services', 'db', 'hosting'],
  dns: ['dns', 'hosting'],
  cdn: ['cdn'],
  ssl: ['ssl'],
  nginx: ['nginx', 'hosting'],
  apache: ['apache', 'hosting'],
  node: ['hosting', 'stack'],
  php: ['hosting', 'stack'],
  python: ['hosting', 'stack'],
  go: ['hosting', 'stack'],
  rust: ['hosting', 'stack'],
  java: ['hosting', 'stack'],
  kotlin: ['hosting', 'stack'],
  bun: ['hosting', 'stack'],
  protection: ['defense', 'protection'],
  security: ['security', 'ssh-key', 'ssh-2fa'],
  vpn: ['vpn'],
  vnc: ['vnc'],
  validators: ['validators'],
  docker: ['docker'],
  users: ['users', 'packages', 'rbac'],
  services: ['services'],
  metrics: ['host'],
  network: ['host', 'network'],
  hostBrowse: null, // intentional UI (or future browse)
  logs: ['logs'],
  terminal: null, // intentional panel-only PTY
  cron: ['cron'],
  backups: ['backup'],
  migrate: ['migrate'],
  updates: ['update', 'updates', 'software', 'stack'],
  systemd: ['system'],
  readiness: ['readiness', 'doctor'],
  systemIndex: ['host', 'system', 'store'],
  support: null, // static Support page — no CLI/API mutations
};

/**
 * Production gaps we already know from code audit (explicit ❌ until implemented).
 * status: missing | partial | ok | panel-only
 */
const KNOWN_GAPS = [
  {
    id: 'vpn',
    panel: 'VPN ensure / peers / clients / monitor / firewall',
    cliNeed: 'vpn',
    status: 'ok',
    note: 'C2: status monitor ensure peers clients firewall presets',
    priority: 'P0',
  },
  {
    id: 'vnc',
    panel: 'VNC accounts / clients / share / novnc / firewall (viewer UI panel-only)',
    cliNeed: 'vnc',
    status: 'ok',
    note: 'C2: full mutation surface; browser canvas ⚠️ panel-only',
    priority: 'P0',
  },
  {
    id: 'apache',
    panel: 'Apache sites / settings apply',
    cliNeed: 'apache',
    status: 'ok',
    note: 'C3: sites + settings + apply + cleanup-conflicts',
    priority: 'P0',
  },
  {
    id: 'service-exposure',
    panel: 'Network service exposure sync (ysk-svc)',
    cliNeed: 'network',
    status: 'ok',
    note: 'C3: network exposure list|get|put|sync',
    priority: 'P0',
  },
  {
    id: 'real-ip',
    panel: 'Real-IP apply',
    cliNeed: 'real-ip',
    status: 'ok',
    note: 'C3: real-ip status|set|refresh',
    priority: 'P1',
  },
  {
    id: 'panel-tls',
    panel: 'Panel TLS status/apply',
    cliNeed: 'ssl',
    status: 'ok',
    note: 'C3: ssl panel-tls status|enable|disable|issue (+ bootstrap)',
    priority: 'P1',
  },
  {
    id: 'updates-inventory',
    panel: 'Updates inventory / package apply',
    cliNeed: 'updates',
    status: 'ok',
    note: 'C4: updates inventory|apply|batch (+ update self binary)',
    priority: 'P1',
  },
  {
    id: 'software-install',
    panel: 'Feature software install/uninstall banners',
    cliNeed: 'software',
    status: 'ok',
    note: 'C4: software list|install|uninstall (+ stack plans)',
    priority: 'P1',
  },
  {
    id: 'db-lifecycle',
    panel: 'DB service console lifecycle / apply',
    cliNeed: 'db',
    status: 'ok',
    note: 'C5: db status|console|apply|lifecycle|install',
    priority: 'P1',
  },
  {
    id: 'sql-engine-switch',
    panel: 'MySQL↔MariaDB engine switch',
    cliNeed: 'db',
    status: 'ok',
    note: 'C5: db sql-engine preview|switch',
    priority: 'P1',
  },
  {
    id: 'redis-keys',
    panel: 'Redis key browser mutations',
    cliNeed: 'redis',
    status: 'ok',
    note: 'C5: redis keys|get|set|del + status/install',
    priority: 'P2',
  },
  {
    id: 'ftp-accounts',
    panel: 'FTP account CRUD',
    cliNeed: 'ftp',
    status: 'ok',
    note: 'C6: ftp accounts + settings + apply',
    priority: 'P2',
  },
  {
    id: 'files-shares-create',
    panel: 'Public file share create (direct|bt|both)',
    cliNeed: 'files',
    status: 'ok',
    note: 'C6: files shares list|create|delete|bt-stats --mode direct|bt|both',
    priority: 'P2',
  },
  {
    id: 'files-shares-bt-stats',
    panel: 'File share BT swarm stats',
    cliNeed: 'files',
    status: 'ok',
    note: 'C6: files shares bt-stats --id',
    priority: 'P2',
  },
  {
    id: 'bt-tracker',
    panel: 'BT Tracker service page (WebTorrent file shares)',
    cliNeed: 'bt-tracker',
    status: 'ok',
    note: 'C6: bt-tracker status|start|stop|settings|torrents; serve boot re-seed',
    priority: 'P2',
  },
  {
    id: 'validators',
    panel: 'Validators (Beta) list / chains / disk',
    cliNeed: 'validators',
    status: 'ok',
    note: 'list|chains|disk|get; install/start later',
    priority: 'P1',
  },
  {
    id: 'docker',
    panel: 'Docker engine / containers / compose',
    cliNeed: 'docker',
    status: 'ok',
    note: 'status|ps|images|compose|prune|engine',
    priority: 'P1',
  },
  {
    id: 'email-depth',
    panel: 'Email aliases / queue / relay',
    cliNeed: 'email',
    status: 'ok',
    note: 'C6: email aliases|queue|relay',
    priority: 'P2',
  },
  {
    id: 'dns-records',
    panel: 'DNS records / dnssec / heal',
    cliNeed: 'dns',
    status: 'ok',
    note: 'C6: dns dnssec|heal|health|lookup|records validate (+ zones)',
    priority: 'P2',
  },
  {
    id: 'runtimes-full',
    panel: 'java/kotlin/bun + switch/uninstall',
    cliNeed: 'runtimes',
    status: 'ok',
    note: 'C7: runtimes list|install|switch|uninstall (+ hosting runtime-*)',
    priority: 'P2',
  },
  {
    id: 'host-browse',
    panel: 'Host Browse (Chromium sessions)',
    cliNeed: null,
    status: 'panel-only',
    note: 'interactive UI; optional session list later',
    priority: 'P3',
  },
  {
    id: 'terminal-pty',
    panel: 'Browser terminal PTY',
    cliNeed: null,
    status: 'panel-only',
    note: 'no remote SSH replacement',
    priority: 'P3',
  },
  {
    id: 'file-preview-editor',
    panel: 'In-browser text/media preview editor',
    cliNeed: null,
    status: 'panel-only',
    priority: 'P3',
  },
  {
    id: 'public-share-landing',
    panel: 'Public /share/:token landing page',
    cliNeed: null,
    status: 'panel-only',
    note: 'create still needs CLI (files shares create)',
    priority: 'P3',
  },
  {
    id: 'support',
    panel: 'Support / donate / YSK Limited',
    cliNeed: null,
    status: 'panel-only',
    note: 'static page; contact email@ysk.hk',
    priority: 'P3',
  },
];

/** Nav key → L2 handbook (null = allowlisted, no handbook required). */
const NAV_HANDBOOK = {
  dashboard: 'docs/getting-started/readiness.md',
  projects: 'docs/features/projects.md',
  email: 'docs/features/email.md',
  files: 'docs/features/files-ftp.md',
  publicFiles: 'docs/features/files-ftp.md',
  ftp: 'docs/features/files-ftp.md',
  btTracker: 'docs/features/bt-tracker.md',
  mysql: 'docs/features/databases.md',
  mysqlService: 'docs/features/databases.md',
  mariadb: 'docs/features/databases.md',
  mariadbService: 'docs/features/databases.md',
  postgres: 'docs/features/databases.md',
  postgresService: 'docs/features/databases.md',
  redis: 'docs/features/databases.md',
  redisService: 'docs/features/databases.md',
  dns: 'docs/features/dns-ssl-nginx.md',
  cdn: 'docs/features/cdn-agents.md',
  ssl: 'docs/features/dns-ssl-nginx.md',
  nginx: 'docs/features/nginx-sites.md',
  apache: 'docs/features/apache.md',
  node: 'docs/features/runtimes.md',
  php: 'docs/features/runtimes.md',
  python: 'docs/features/runtimes.md',
  go: 'docs/features/runtimes.md',
  rust: 'docs/features/runtimes.md',
  java: 'docs/features/runtimes.md',
  kotlin: 'docs/features/runtimes.md',
  bun: 'docs/features/runtimes.md',
  protection: 'docs/features/defense.md',
  security: 'docs/features/security-auth.md',
  vpn: 'docs/features/vpn.md',
  vnc: 'docs/features/vnc.md',
  validators: 'docs/features/validators.md',
  docker: 'docs/features/docker.md',
  users: 'docs/features/users-rbac.md',
  services: 'docs/features/system-host.md',
  metrics: 'docs/features/logs-metrics.md',
  network: 'docs/features/system-host.md',
  hostBrowse: 'docs/features/host-browse.md',
  logs: 'docs/features/logs-metrics.md',
  terminal: null,
  cron: 'docs/features/backups-cron.md',
  backups: 'docs/features/backups-cron.md',
  migrate: 'docs/features/migrate.md',
  updates: 'docs/features/system-host.md',
  systemd: 'docs/features/system-host.md',
  readiness: 'docs/getting-started/readiness.md',
  systemIndex: 'docs/features/system-host.md',
  support: null,
};

/** Panel path × CLI × API prefix (catalog, not OpenAPI). */
const API_GROUPS = [
  { id: 'auth', panel: '/login', cli: null, api: '/api/v1/auth', note: 'session; not a sidebar item' },
  { id: 'projects', panel: '/projects', cli: 'projects', api: '/api/v1/projects' },
  { id: 'email', panel: '/email', cli: 'email', api: '/api/v1/email' },
  { id: 'files', panel: '/files', cli: 'files', api: '/api/v1/files' },
  { id: 'ftp', panel: '/ftp', cli: 'ftp', api: '/api/v1/ftp' },
  { id: 'bt-tracker', panel: '/bt-tracker', cli: 'bt-tracker', api: '/api/v1/bt-tracker' },
  { id: 'dns', panel: '/dns', cli: 'dns', api: '/api/v1/dns' },
  { id: 'ssl', panel: '/ssl', cli: 'ssl', api: '/api/v1/ssl' },
  { id: 'nginx', panel: '/nginx', cli: 'nginx', api: '/api/v1/nginx' },
  { id: 'apache', panel: '/apache', cli: 'apache', api: '/api/v1/apache' },
  { id: 'cdn', panel: '/cdn', cli: 'cdn', api: '/api/v1/cdn' },
  { id: 'db', panel: '/databases/mysql', cli: 'db', api: '/api/v1/resources' },
  { id: 'redis', panel: '/databases/redis', cli: 'redis', api: '/api/v1/redis' },
  { id: 'runtimes', panel: '/runtimes/node', cli: 'runtimes', api: '/api/v1/hosting/runtimes' },
  { id: 'protection', panel: '/protection', cli: 'defense', api: '/api/v1/defense' },
  { id: 'security', panel: '/security', cli: 'security', api: '/api/v1/security' },
  { id: 'vpn', panel: '/vpn', cli: 'vpn', api: '/api/v1/vpn' },
  { id: 'vnc', panel: '/vnc', cli: 'vnc', api: '/api/v1/vnc' },
  { id: 'validators', panel: '/validators', cli: 'validators', api: '/api/v1/validators' },
  { id: 'docker', panel: '/docker', cli: 'docker', api: '/api/v1/docker' },
  { id: 'users', panel: '/users', cli: 'users', api: '/api/v1/users' },
  { id: 'services', panel: '/services', cli: 'services', api: '/api/v1/system' },
  { id: 'network', panel: '/network', cli: 'network', api: '/api/v1/network' },
  { id: 'host-browse', panel: '/browse', cli: null, api: '/api/v1/host-browse', note: 'panel-only UX' },
  { id: 'logs', panel: '/logs', cli: 'logs', api: '/api/v1/logs' },
  { id: 'cron', panel: '/cron', cli: 'cron', api: '/api/v1/cron' },
  { id: 'backups', panel: '/backups', cli: 'backup', api: '/api/v1/backups' },
  { id: 'migrate', panel: '/system/migrate', cli: 'migrate', api: '/api/v1/system/migrate' },
  { id: 'updates', panel: '/updates', cli: 'updates', api: '/api/v1/updates' },
  { id: 'readiness', panel: '/system/readiness', cli: 'readiness', api: '/api/v1/readiness' },
  { id: 'share', panel: '/share/:token', cli: null, api: '/api/v1/public', note: 'public share landing' },
];

const cliSrc = read('apps/server/src/cli.ts');
const navSrc = read('apps/web/src/shared/nav/features.ts');

const cliCommands = parseCliCommands(cliSrc);
const handlers = parseCommandHandlers(cliSrc);
const nav = parseNavFeatures(navSrc);

const cliSet = new Set([...cliCommands, ...handlers]);

function cliHas(token) {
  if (!token) return false;
  const first = String(token).split(/\s+/)[0];
  return cliSet.has(first);
}

const navRows = nav.map((item) => {
  const need = NAV_TO_CLI[item.key];
  if (need === null) {
    return { ...item, status: 'panel-only', coveredBy: [] };
  }
  const list = Array.isArray(need) ? need : [need];
  const covered = list.filter((c) => cliHas(c));
  const status = covered.length === 0 ? 'missing' : covered.length < list.length ? 'partial' : 'ok';
  return { ...item, status, coveredBy: covered, expected: list };
});

const gapRows = KNOWN_GAPS.map((g) => {
  const cliPresent = g.cliNeed ? cliHas(g.cliNeed) : null;
  // Flip missing → ok when top-level CLI command already exists
  let status = g.status;
  if (status === 'missing' && g.cliNeed && cliPresent) status = 'ok';
  if (status === 'ok' && g.cliNeed && cliPresent === false) status = 'missing';
  const resolved =
    status === 'ok' || status === 'panel-only'
      ? true
      : false;
  return { ...g, status, cliPresent, resolved };
});

const refMd = read('docs/cli/reference.md');
const cliMissingFromReference = cliCommands.filter((c) => {
  if (c === 'doctor') return !/doctor/.test(refMd);
  return !new RegExp(`(?:ysk-server\\s+${c}\\b|##[^\\n]*\\b${c}\\b)`).test(refMd);
});

const handbookMissing = nav
  .map((item) => {
    const book = Object.prototype.hasOwnProperty.call(NAV_HANDBOOK, item.key)
      ? NAV_HANDBOOK[item.key]
      : undefined;
    if (book === null) return null;
    if (!book) return { key: item.key, path: null, reason: 'unmapped' };
    if (!existsSync(join(root, book))) return { key: item.key, path: book, reason: 'missing-file' };
    return null;
  })
  .filter(Boolean);

const apiGroupRows = API_GROUPS.map((g) => ({
  ...g,
  cliPresent: g.cli ? cliHas(g.cli) : null,
}));

const navMissing = navRows.filter((r) => r.status === 'missing').map((r) => r.key);
const navPartial = navRows.filter((r) => r.status === 'partial').map((r) => r.key);
const navPanelOnly = navRows.filter((r) => r.status === 'panel-only').map((r) => r.key);

const summary = {
  generatedAt: new Date().toISOString(),
  cliCommandsCount: cliCommands.length,
  cliCommands,
  handlersCount: handlers.length,
  handlers,
  navCount: nav.length,
  navMissing,
  navPartial,
  navPanelOnly,
  knownGaps: gapRows,
  openGaps: gapRows.filter((g) => g.status === 'missing' || g.status === 'partial'),
  missingCount: gapRows.filter((g) => g.status === 'missing').length,
  partialCount: gapRows.filter((g) => g.status === 'partial').length,
  panelOnlyCount: gapRows.filter((g) => g.status === 'panel-only').length,
  okCount: gapRows.filter((g) => g.status === 'ok').length,
  cliMissingFromReference,
  handbookMissing,
  apiGroups: apiGroupRows,
};

const outDir = join(root, 'docs/cli');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const reportPath = join(outDir, 'parity-inventory.json');
writeFileSync(reportPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
const controlPath = join(outDir, 'control-plane-inventory.json');
writeFileSync(controlPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

if (jsonOut) {
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} else {
  console.log('cli-panel-parity');
  console.log(`  CLI_COMMANDS: ${summary.cliCommandsCount}`);
  console.log(`  handlers:     ${summary.handlersCount}`);
  console.log(`  nav items:    ${summary.navCount}`);
  console.log(`  known ❌ missing: ${summary.missingCount}`);
  console.log(`  known ⚠️ partial: ${summary.partialCount}`);
  console.log(`  known panel-only: ${summary.panelOnlyCount}`);
  console.log(`  nav missing:  ${navMissing.join(', ') || '—'}`);
  console.log(`  ref missing:  ${cliMissingFromReference.join(', ') || '—'}`);
  console.log(`  handbook miss:${handbookMissing.length}`);
  console.log('  open gaps:');
  for (const g of summary.openGaps) {
    console.log(`    [${g.priority}] ${g.id}: ${g.panel} → need ${g.cliNeed ?? '—'} (${g.status})`);
  }
  console.log(`  wrote ${reportPath}`);
  console.log(`  wrote ${controlPath}`);
}

const strictFail =
  summary.missingCount > 0 ||
  navMissing.length > 0 ||
  cliMissingFromReference.length > 0 ||
  handbookMissing.length > 0;

if (strict && strictFail) {
  console.error('FAIL: unmarked control-plane gaps');
  if (navMissing.length) console.error('  nav:', navMissing.join(', '));
  if (cliMissingFromReference.length) {
    console.error('  not in cli/reference.md:', cliMissingFromReference.join(', '));
  }
  if (handbookMissing.length) console.error('  handbook:', JSON.stringify(handbookMissing));
  process.exit(1);
}
process.exit(0);
