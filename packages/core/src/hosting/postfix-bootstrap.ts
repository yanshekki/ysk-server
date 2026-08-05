/**
 * Postfix package can be installed while systemd refuses to start:
 *   ConditionPathExists=/etc/postfix/main.cf was not met
 *
 * Debian "No configuration" debconf (and incomplete configure) leave only
 * main.cf.proto / master.cf — never a real main.cf.
 */

import type { HostExecutor } from '../host/executor.js';

const MAIN_CF = '/etc/postfix/main.cf';
const MAIN_CF_PROTO = '/etc/postfix/main.cf.proto';
const MAIN_CF_DEBIAN = '/usr/share/postfix/main.cf.debian';

export type EnsurePostfixMainCfResult = {
  ok: boolean;
  created: boolean;
  path?: string;
  notes: string[];
};

/** True when main.cf is missing (unit will stay inactive even if package+enabled). */
export async function postfixMainCfMissing(host: HostExecutor): Promise<boolean> {
  try {
    return !host.pathExists(MAIN_CF);
  } catch {
    return true;
  }
}

/**
 * Noninteractive debconf so apt postinst generates a real main.cf.
 * Prefer Internet Site + hostname mailname over "No configuration".
 */
export async function preseedPostfixDebconf(host: HostExecutor): Promise<string[]> {
  const notes: string[] = [];
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      [
        'set -e',
        'MAILNAME="$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo localhost)"',
        'echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections',
        'echo "postfix postfix/mailname string $MAILNAME" | debconf-set-selections',
        'echo "postfix postfix/destinations string $MAILNAME, localhost.localdomain, localhost" | debconf-set-selections || true',
      ].join('\n'),
    ],
    { timeoutMs: 15_000 },
  );
  if (r.exitCode === 0) {
    notes.push('postfix debconf: Internet Site (will generate main.cf)');
  } else {
    notes.push(`postfix debconf preseed soft-fail: ${r.stderr || r.stdout || r.exitCode}`);
  }
  return notes;
}

/**
 * Ensure /etc/postfix/main.cf exists so systemd ConditionPathExists is met.
 * Safe: only creates when missing; never overwrites an existing main.cf.
 */
export async function ensurePostfixMainCf(host: HostExecutor): Promise<EnsurePostfixMainCfResult> {
  const notes: string[] = [];
  if (host.pathExists(MAIN_CF)) {
    return { ok: true, created: false, path: MAIN_CF, notes };
  }

  let src = '';
  if (host.pathExists(MAIN_CF_PROTO)) src = MAIN_CF_PROTO;
  else if (host.pathExists(MAIN_CF_DEBIAN)) src = MAIN_CF_DEBIAN;

  if (!src) {
    notes.push(
      'postfix main.cf missing and no template (main.cf.proto / main.cf.debian) — install postfix package or run dpkg-reconfigure postfix',
    );
    return { ok: false, created: false, notes };
  }

  const r = await host.runCommand(['cp', '-a', src, MAIN_CF], { timeoutMs: 10_000 });
  if (r.exitCode !== 0) {
    notes.push(`failed to create main.cf from ${src}: ${r.stderr || r.stdout || r.exitCode}`);
    return { ok: false, created: false, notes };
  }

  // Best-effort permissions / layout (ignore failure)
  await host.runCommand(['bash', '-c', 'postfix set-permissions 2>/dev/null || true'], {
    timeoutMs: 15_000,
  });

  notes.push(
    `created ${MAIN_CF} from ${src} (was missing — systemd ConditionPathExists would skip start)`,
  );
  return { ok: true, created: true, path: MAIN_CF, notes };
}

/**
 * Preflight before start/enable: create main.cf if needed, return notes.
 */
export async function preparePostfixForStart(host: HostExecutor): Promise<{
  ok: boolean;
  notes: string[];
}> {
  if (!(await postfixMainCfMissing(host))) {
    return { ok: true, notes: [] };
  }
  const r = await ensurePostfixMainCf(host);
  return { ok: r.ok, notes: r.notes };
}
