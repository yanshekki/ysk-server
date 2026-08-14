#!/usr/bin/env node
/**
 * Enforce: software product names + company name stay English in every locale.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'packages/shared/locales');

const NAV_EXACT = {
  node: 'Node.js',
  php: 'PHP',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  kotlin: 'Kotlin',
  bun: 'Bun',
  nginx: 'Nginx',
  apache: 'Apache',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgres: 'PostgreSQL',
  redis: 'Redis',
  ftp: 'FTPS',
  ftpService: 'FTPS',
  fail2ban: 'fail2ban',
  systemd: 'systemd',
  btTracker: 'BT Tracker',
  cdn: 'CDN',
  vpn: 'VPN',
  vnc: 'VNC',
  dns: 'DNS',
};

/** Must appear as whole token (not transliterated). */
const REQUIRED_TOKENS = [
  'YSK Limited',
  'YSK Server',
  'Nginx',
  'Apache',
  'MySQL',
  'MariaDB',
  'PostgreSQL',
  'Redis',
  'Node.js',
  'PHP',
  'Python',
  'Postfix',
  'Dovecot',
  'OpenDKIM',
  'PowerDNS',
  'fail2ban',
  'Certbot',
  'OPcache',
  'Chromium',
  'WireGuard',
  'OpenVPN',
  'Shadowsocks',
  'InnoDB',
  "Let's Encrypt",
  'journalctl',
  'PM2',
];

const FORBIDDEN = [
  /YSK\s*有限公司/,
  /YSK有限公司/,
  /投稿/,
  /ダブコット/,
  /パワーDNS/,
  /fail\s+2\s+ban/i,
  /顆粒物/,
];

function locales() {
  return readdirSync(localesDir)
    .filter((n) => {
      try {
        return statSync(join(localesDir, n)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function load(loc, file) {
  return JSON.parse(readFileSync(join(localesDir, loc, file), 'utf8'));
}

const fails = [];

for (const loc of locales()) {
  const nav = load(loc, 'nav.json');
  for (const [k, want] of Object.entries(NAV_EXACT)) {
    if (nav[k] != null && nav[k] !== want) {
      fails.push(`${loc}/nav.json ${k}: expected "${want}" got "${nav[k]}"`);
    }
  }
  if (nav.go === '去' || nav.go === '가다' || nav.go === 'जाना') {
    fails.push(`${loc}/nav.json go must stay "Go"`);
  }

  const cat = load(loc, 'catalog.json');
  const sw = cat.sw || {};
  const must = {
    nginx: /Nginx/,
    postfix: /^Postfix$/,
    dovecot: /^Dovecot$/,
    fail2ban: /^fail2ban$/,
    pdns_server: /PowerDNS/,
    node: /Node\.js/,
    php: /^PHP$/,
    python: /Python/,
    go: /^Go$/,
    rust: /Rust/,
    chromium: /Chromium/,
    opendkim: /OpenDKIM/,
    certbot: /Certbot/,
  };
  for (const [k, re] of Object.entries(must)) {
    const v = sw[k];
    if (v != null && !re.test(v)) {
      fails.push(`${loc}/catalog.json sw.${k}: "${v}" must keep English product name`);
    }
  }
  if (cat.php?.opcache && cat.php.opcache !== 'OPcache') {
    fails.push(`${loc}/catalog.json php.opcache must be OPcache`);
  }

  const sup = load(loc, 'support.json');
  if (sup.yskTitle !== 'YSK Limited') {
    fails.push(`${loc}/support.json yskTitle must be "YSK Limited"`);
  }
  const blob = JSON.stringify({ nav, cat, sup });
  for (const re of FORBIDDEN) {
    if (re.test(blob)) {
      fails.push(`${loc}: forbidden brand/MT pattern ${re}`);
    }
  }
}

if (fails.length) {
  console.error('i18n-brand-freeze FAIL');
  for (const f of fails.slice(0, 80)) console.error('  ' + f);
  if (fails.length > 80) console.error(`  … +${fails.length - 80} more`);
  process.exit(1);
}
console.log('i18n-brand-freeze');
console.log(`  locales: ${locales().length}`);
console.log('OK: software + company names frozen in English');
void REQUIRED_TOKENS;
