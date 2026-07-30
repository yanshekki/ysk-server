import { tl } from '@ysk/shared';
/**
 * Optional WordPress core download into project public/ (Spec one-click apps).
 * Requires network + host tools; never fakes success without YSK_EXECUTE.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';

export interface WordpressDownloadResult {
  ok: boolean;
  executed: boolean;
  requiresExecute: boolean;
  docRoot: string;
  notes: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
  hasWpSettings: boolean;
}

const WP_URL = 'https://wordpress.org/latest.tar.gz';

/**
 * Download and extract WordPress into homeDir/app/public.
 * - Without EXECUTE: ok=false, notes with manual command.
 * - With EXECUTE: curl | tar (needs curl/tar and network).
 */
export async function downloadWordpressCore(input: {
  host: HostExecutor;
  homeDir: string;
  /** Skip if wp-settings.php already present unless force */
  force?: boolean;
}): Promise<WordpressDownloadResult> {
  const docRoot = join(input.homeDir, 'app', 'public');
  mkdirSync(docRoot, { recursive: true });
  const notes: string[] = [];
  const commandResults: WordpressDownloadResult['commandResults'] = [];
  const hasWpSettings = existsSync(join(docRoot, 'wp-settings.php'));

  if (hasWpSettings && !input.force) {
    return {
      ok: true,
      executed: false,
      requiresExecute: false,
      docRoot,
      notes: ['WordPress core already present (wp-settings.php) — skipped'],
      commandResults: [],
      hasWpSettings: true,
    };
  }

  if (!input.host.executeEnabled()) {
    notes.push(tl('notes.auto.n1142'));
    writeFileSync(
      join(input.homeDir, 'app', 'WORDPRESS_DOWNLOAD.txt'),
      'Download WordPress via admin panel when host mutations are enabled.\n',
      'utf8',
    );
    return {
      ok: false,
      executed: false,
      requiresExecute: true,
      docRoot,
      notes,
      commandResults: [],
      hasWpSettings: false,
    };
  }

  // Clear skeleton index.php if forcing
  const cmd = [
    'bash',
    '-c',
    `set -euo pipefail; mkdir -p "${docRoot}"; cd "${docRoot}"; curl -fsSL "${WP_URL}" | tar xz --strip-components=1`,
  ];
  const r = await input.host.runCommand(cmd, { timeoutMs: 300_000 });
  commandResults.push({ argv: cmd, exitCode: r.exitCode, stderr: r.stderr });
  const ok = r.exitCode === 0 && existsSync(join(docRoot, 'wp-settings.php'));
  notes.push(
    ok
      ? `WordPress extracted to ${docRoot}`
      : `Download/extract failed: ${r.stderr || r.stdout || `exit ${r.exitCode}`}`,
  );
  if (ok) {
    const files = readdirSync(docRoot).slice(0, 12);
    notes.push(`Files sample: ${files.join(', ')}`);
  }
  return {
    ok,
    executed: true,
    requiresExecute: false,
    docRoot,
    notes,
    commandResults,
    hasWpSettings: existsSync(join(docRoot, 'wp-settings.php')),
  };
}
