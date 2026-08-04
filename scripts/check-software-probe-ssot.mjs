#!/usr/bin/env node
/**
 * Soft gate: product catalog software presence checks should use HostSoftwareProbe.
 * Flags new ad-hoc `command -v` in known product modules (exit 1 if found outside allowlist).
 *
 * Usage: node scripts/check-software-probe-ssot.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOSTING = join(ROOT, 'packages/core/src/hosting');

/** Modules that still may use command -v (tools / migrate / install bash) */
const ALLOW_PREFIX = [
  'software-probe/',
  'host-migrate/',
  'dns-zone.ts',
  'dns-lookup.ts',
  'dns-cluster.ts',
  'db-cluster/',
  'project-ops.ts',
  'project-os-user.ts',
  'mysql-provision.ts', // data-plane CLI still uses mysql binary for queries
];

/** Must not grow new ad-hoc presence probes */
const STRICT_FILES = [
  'service-console.ts',
  'db-engine.ts',
  'software-install.ts',
  'redis-browser.ts',
  'firewall-ops.ts',
  'ftps-service.ts',
  'db-service-config.ts',
  'stack/ops.ts',
  'service-matrix.ts',
  'backup-restic.ts',
  'powerdns-apply.ts',
  'pm2-apply.ts',
  'mysql-provision.ts',
  'postgres-provision.ts',
  'runtime-probe.ts',
  'dnssec.ts',
  'log-center/service.ts',
  'git-deploy.ts',
  'production-readiness.ts',
  'redis-provision.ts',
];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.ts') && !name.includes('.test.')) acc.push(p);
  }
  return acc;
}

const files = walk(HOSTING);
const offenders = [];

for (const file of files) {
  const rel = relative(HOSTING, file).replace(/\\/g, '/');
  if (ALLOW_PREFIX.some((a) => rel.startsWith(a) || rel === a)) continue;
  if (!STRICT_FILES.some((s) => rel === s || rel.endsWith('/' + s))) continue;

  const src = readFileSync(file, 'utf8');
  // Flag standalone product probes, not comments
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('command -v') && !line.trim().startsWith('//') && !line.includes('HostSoftwareProbe')) {
      // allow install/apply bash one-liners / generated shell helpers (not product presence UI)
      if (line.includes('apt-get install')) return;
      if (line.includes('db_load')) return;
      if (line.includes('pdnsutil load-zone') || line.includes("'/if command -v") || line.includes("'if command -v"))
        return;
      if (line.trim().startsWith("'") && line.includes('command -v')) return; // string fragment in shell script builder
      offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  });
}

if (offenders.length) {
  console.error('software-probe SSOT: ad-hoc command -v in strict modules:\n' + offenders.join('\n'));
  process.exit(1);
}
console.log('software-probe SSOT: OK (strict modules clean)');
