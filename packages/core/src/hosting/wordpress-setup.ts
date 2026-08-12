import { tl } from '@ysk-server/shared';
/**
 * One-click WordPress path: download core + write wp-config from env + chown + checklist.
 * Honest: download needs EXECUTE+network; DB provision is separate step.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { HostExecutor } from '../host/executor.js';
import { downloadWordpressCore, type WordpressDownloadResult } from './wordpress-download.js';
import { chownProjectTree } from './project-ownership.js';

export interface WordpressSetupResult extends WordpressDownloadResult {
  wpConfigWritten: boolean;
  nextSteps: string[];
  chowned: boolean;
}

function generateSalts(): Record<string, string> {
  const keys = [
    'AUTH_KEY',
    'SECURE_AUTH_KEY',
    'LOGGED_IN_KEY',
    'NONCE_KEY',
    'AUTH_SALT',
    'SECURE_AUTH_SALT',
    'LOGGED_IN_SALT',
    'NONCE_SALT',
  ];
  const out: Record<string, string> = {};
  for (const k of keys) {
    out[k] = randomBytes(32).toString('base64');
  }
  return out;
}

/**
 * Ensure wp-config.php exists (from sample) with env-based DB + salts.
 * Does not overwrite existing wp-config.php unless forceConfig.
 */
export function ensureWpConfig(input: {
  docRoot: string;
  forceConfig?: boolean;
  dbName?: string;
  dbUser?: string;
  dbPassword?: string;
  dbHost?: string;
  tablePrefix?: string;
}): { written: boolean; path: string; notes: string[] } {
  const notes: string[] = [];
  const cfg = join(input.docRoot, 'wp-config.php');
  if (existsSync(cfg) && !input.forceConfig) {
    return { written: false, path: cfg, notes: [tl('notes.auto.n0467')] };
  }
  const sample =
    join(input.docRoot, 'wp-config-sample.php');
  const yskSample = join(input.docRoot, 'wp-config-sample-ysk.php');
  let base = '';
  if (existsSync(sample)) {
    base = readFileSync(sample, 'utf8');
  } else if (existsSync(yskSample)) {
    base = readFileSync(yskSample, 'utf8');
  } else {
    // Minimal config if core not fully present
    base = [
      '<?php',
      "define('DB_NAME', 'wordpress');",
      "define('DB_USER', 'wp');",
      "define('DB_PASSWORD', '');",
      "define('DB_HOST', 'localhost');",
      "define('DB_CHARSET', 'utf8mb4');",
      "$table_prefix = 'wp_';",
      "if ( ! defined( 'ABSPATH' ) ) { define( 'ABSPATH', __DIR__ . '/' ); }",
      "require_once ABSPATH . 'wp-settings.php';",
      '',
    ].join('\n');
  }

  const salts = generateSalts();
  const dbName = input.dbName ?? process.env.WP_DB_NAME ?? 'wordpress';
  const dbUser = input.dbUser ?? process.env.WP_DB_USER ?? 'wp';
  const dbPass = input.dbPassword ?? process.env.WP_DB_PASSWORD ?? '';
  const dbHost = input.dbHost ?? process.env.WP_DB_HOST ?? 'localhost';
  const prefix = input.tablePrefix ?? 'wp_';

  let out = base;
  out = out.replace(/define\(\s*'DB_NAME'\s*,\s*'[^']*'\s*\)/, `define('DB_NAME', '${dbName.replace(/'/g, "\\'")}')`);
  out = out.replace(/define\(\s*'DB_USER'\s*,\s*'[^']*'\s*\)/, `define('DB_USER', '${dbUser.replace(/'/g, "\\'")}')`);
  out = out.replace(
    /define\(\s*'DB_PASSWORD'\s*,\s*'[^']*'\s*\)/,
    `define('DB_PASSWORD', '${dbPass.replace(/'/g, "\\'")}')`,
  );
  out = out.replace(/define\(\s*'DB_HOST'\s*,\s*'[^']*'\s*\)/, `define('DB_HOST', '${dbHost.replace(/'/g, "\\'")}')`);
  out = out.replace(/\$table_prefix\s*=\s*'[^']*'/, `$table_prefix = '${prefix.replace(/'/g, "\\'")}';`);

  for (const [k, v] of Object.entries(salts)) {
    const re = new RegExp(`define\\(\\s*'${k}'\\s*,\\s*'[^']*'\\s*\\)`);
    if (re.test(out)) {
      out = out.replace(re, `define('${k}', '${v}')`);
    } else {
      // insert before stop editing comment if missing
      out = out.replace(
        /\/\* That's all/,
        `define('${k}', '${v}');\n/* That's all`,
      );
    }
  }

  // Prefer env overrides for production
  if (!out.includes('getenv')) {
    out = out.replace(
      /<\?php/,
      `<?php
// YSK: prefer environment when set
if (getenv('WP_DB_NAME')) define('DB_NAME', getenv('WP_DB_NAME'));
if (getenv('WP_DB_USER')) define('DB_USER', getenv('WP_DB_USER'));
if (getenv('WP_DB_PASSWORD')) define('DB_PASSWORD', getenv('WP_DB_PASSWORD'));
if (getenv('WP_DB_HOST')) define('DB_HOST', getenv('WP_DB_HOST'));
`,
    );
  }

  writeFileSync(cfg, out, 'utf8');
  notes.push(tl('notes.auto.t0305', { v0: (cfg), v1: (dbName), v2: (dbHost) }));
  if (!dbPass) {
    notes.push(tl('notes.auto.n0094'));
  }
  return { written: true, path: cfg, notes };
}

/**
 * Full one-click path for panel button.
 */
export async function setupWordpress(input: {
  host: HostExecutor;
  homeDir: string;
  linuxUser?: string;
  linuxGroup?: string;
  force?: boolean;
  forceConfig?: boolean;
  dbName?: string;
  dbUser?: string;
  dbPassword?: string;
  dbHost?: string;
}): Promise<WordpressSetupResult> {
  const dl = await downloadWordpressCore({
    host: input.host,
    homeDir: input.homeDir,
    force: input.force,
  });
  const notes = [...dl.notes];
  let wpConfigWritten = false;
  let chowned = false;

  if (dl.hasWpSettings || dl.ok) {
    const cfg = ensureWpConfig({
      docRoot: dl.docRoot,
      forceConfig: input.forceConfig,
      dbName: input.dbName,
      dbUser: input.dbUser,
      dbPassword: input.dbPassword,
      dbHost: input.dbHost,
    });
    wpConfigWritten = cfg.written;
    notes.push(...cfg.notes);
  }

  if (input.linuxUser && (dl.ok || dl.hasWpSettings)) {
    const ch = await chownProjectTree(input.host, {
      linuxUser: input.linuxUser,
      linuxGroup: input.linuxGroup || input.linuxUser,
      homeDir: input.homeDir,
    });
    chowned = ch.ok;
    notes.push(...ch.notes);
  }

  const nextSteps = [
    tl('notes.auto.n1289'),
    tl('notes.auto.n0627'),
    tl('notes.auto.n1498'),
    tl('notes.auto.n1056'),
    tl('notes.auto.n0616'),
  ];

  return {
    ...dl,
    notes,
    wpConfigWritten,
    chowned,
    nextSteps,
    ok: dl.ok || dl.hasWpSettings,
  };
}
