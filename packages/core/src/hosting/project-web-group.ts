import { tl } from '@yanshekki/shared';
/**
 * Nginx/static readability: shared system group so www-data can read project homes
 * without world-readable 755.
 *
 * Strategy A (Hestia-style):
 * - groupadd ysk-web
 * - usermod -aG ysk-web www-data (if exists)
 * - usermod -aG ysk-web $linuxUser
 * - chgrp ysk-web home; chmod 750
 * - public dirs g+rX
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { shellQuote } from './project-user-run.js';

/** Shared group for panel + web server read access */
export const YSK_WEB_GROUP = 'ysk-web';

export interface WebGroupApplyResult {
  ok: boolean;
  notes: string[];
  applied: boolean;
  blocked: boolean;
}

/**
 * Ensure ysk-web exists, add project user + www-data, fix home group bits.
 */
export async function applyProjectWebGroupAccess(input: {
  host: HostExecutor;
  linuxUser: string;
  linuxGroup?: string;
  homeDir: string;
}): Promise<WebGroupApplyResult> {
  const notes: string[] = [];
  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    return {
      ok: false,
      applied: false,
      blocked: true,
      notes: [tl('notes.auto.n0475')],
    };
  }
  const u = input.linuxUser.trim();
  const home = input.homeDir;
  if (!u || !home) {
    return { ok: false, applied: false, blocked: false, notes: [tl('notes.auto.n1324')] };
  }

  const safeUser = u.replace(/[^a-zA-Z0-9._-]/g, '');
  if (safeUser !== u) {
    return { ok: false, applied: false, blocked: false, notes: [tl('notes.auto.t0348', { v0: (u) })] };
  }

  const script = [
    `groupadd --system ${YSK_WEB_GROUP} 2>/dev/null || true`,
    `id www-data >/dev/null 2>&1 && usermod -aG ${YSK_WEB_GROUP} www-data 2>/dev/null || true`,
    `id nginx >/dev/null 2>&1 && usermod -aG ${YSK_WEB_GROUP} nginx 2>/dev/null || true`,
    `usermod -aG ${YSK_WEB_GROUP} ${safeUser} 2>/dev/null || true`,
    existsSync(home)
      ? `chgrp -R ${YSK_WEB_GROUP} ${shellQuote(home)} 2>/dev/null || true`
      : `true`,
    existsSync(home) ? `chmod 750 ${shellQuote(home)} 2>/dev/null || true` : `true`,
    // public / static trees group-readable
    ...['app/public', 'public', 'app'].map((rel) => {
      const p = join(home, rel);
      return existsSync(p)
        ? `chmod -R g+rX ${shellQuote(p)} 2>/dev/null || true`
        : `true`;
    }),
  ].join('\n');

  const r = await input.host.runCommand(['bash', '-c', script], { timeoutMs: 60_000 });
  if (r.exitCode === 0) {
    notes.push(
      tl('notes.auto.t0349', { v0: (YSK_WEB_GROUP), v1: (safeUser) }),
    );
    return { ok: true, applied: true, blocked: false, notes };
  }
  notes.push(tl('notes.auto.t0350', { v0: ((r.stderr || r.stdout || '').slice(0, 200)) }));
  return { ok: false, applied: false, blocked: false, notes };
}

/** Shell lines for inclusion in useradd provision scripts */
export function webGroupProvisionCommands(linuxUser: string, homeDir: string): string[] {
  const u = linuxUser.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!u) return [];
  return [
    `groupadd --system ${YSK_WEB_GROUP} 2>/dev/null || true`,
    `id www-data >/dev/null 2>&1 && usermod -aG ${YSK_WEB_GROUP} www-data 2>/dev/null || true`,
    `usermod -aG ${YSK_WEB_GROUP} ${u} 2>/dev/null || true`,
    `chgrp -R ${YSK_WEB_GROUP} ${homeDir} 2>/dev/null || true`,
    `chmod 750 ${homeDir} 2>/dev/null || true`,
    `chmod -R g+rX ${homeDir}/app/public ${homeDir}/public ${homeDir}/app 2>/dev/null || true`,
  ];
}
