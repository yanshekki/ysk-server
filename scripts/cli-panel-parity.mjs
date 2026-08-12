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
  dashboard: ['health', 'readiness', 'host'],
  projects: ['projects'],
  email: ['email'],
  files: ['files'],
  publicFiles: ['hosting', 'files'],
  ftp: ['hosting', 'ftp'],
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
    panel: 'Public file share create',
    cliNeed: 'files',
    status: 'ok',
    note: 'C6: files shares list|create|delete',
    priority: 'P2',
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

const summary = {
  generatedAt: new Date().toISOString(),
  cliCommandsCount: cliCommands.length,
  cliCommands,
  handlersCount: handlers.length,
  handlers,
  navCount: nav.length,
  navMissing: navRows.filter((r) => r.status === 'missing').map((r) => r.key),
  navPartial: navRows.filter((r) => r.status === 'partial').map((r) => r.key),
  navPanelOnly: navRows.filter((r) => r.status === 'panel-only').map((r) => r.key),
  knownGaps: gapRows,
  openGaps: gapRows.filter((g) => g.status === 'missing' || g.status === 'partial'),
  missingCount: gapRows.filter((g) => g.status === 'missing').length,
  partialCount: gapRows.filter((g) => g.status === 'partial').length,
  panelOnlyCount: gapRows.filter((g) => g.status === 'panel-only').length,
  okCount: gapRows.filter((g) => g.status === 'ok').length,
};

const outDir = join(root, 'docs/cli');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const reportPath = join(outDir, 'parity-inventory.json');
writeFileSync(reportPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

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
  console.log('  open gaps:');
  for (const g of summary.openGaps) {
    console.log(`    [${g.priority}] ${g.id}: ${g.panel} → need ${g.cliNeed ?? '—'} (${g.status})`);
  }
  console.log(`  wrote ${reportPath}`);
}

if (strict && summary.missingCount > 0) {
  process.exit(1);
}
process.exit(0);
