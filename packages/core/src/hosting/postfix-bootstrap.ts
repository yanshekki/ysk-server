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
 * postqueue/postdrop require setgid_group (usually postdrop).
 * Empty `setgid_group =` yields: fatal: bad string length 0 < 1: setgid_group =
 */
export async function ensurePostfixSetgidGroup(
  host: HostExecutor,
): Promise<{ ok: boolean; fixed: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (!host.executeEnabled()) {
    return {
      ok: false,
      fixed: false,
      notes: ['setgid_group check needs YSK_EXECUTE'],
    };
  }
  const get = await host.runCommand(
    ['bash', '-c', 'postconf -h setgid_group 2>/dev/null || true'],
    { timeoutMs: 8_000 },
  );
  const cur = (get.stdout || '').trim();
  if (cur) {
    return { ok: true, fixed: false, notes: [`setgid_group=${cur}`] };
  }
  // Prefer postdrop group if present
  const set = await host.runCommand(
    [
      'bash',
      '-c',
      [
        'set -e',
        'G=postdrop',
        'getent group postdrop >/dev/null 2>&1 || G=postfix',
        'getent group "$G" >/dev/null 2>&1 || G=mail',
        'postconf -e "setgid_group=$G"',
        'postconf -h setgid_group',
      ].join('\n'),
    ],
    { timeoutMs: 15_000 },
  );
  const after = (set.stdout || '').trim();
  if (set.exitCode === 0 && after) {
    notes.push(`set setgid_group=${after} (was empty — postqueue needs this)`);
    // Soft: reload so queue tools pick up conf (ignore failure)
    await host.runCommand(
      ['bash', '-c', 'postfix reload 2>/dev/null || systemctl reload postfix 2>/dev/null || true'],
      { timeoutMs: 15_000 },
    );
    return { ok: true, fixed: true, notes };
  }
  notes.push(
    `could not set setgid_group: ${set.stderr || set.stdout || set.exitCode}`,
  );
  return { ok: false, fixed: false, notes };
}

/**
 * Preflight before start/enable: create main.cf if needed, return notes.
 */
export async function preparePostfixForStart(host: HostExecutor): Promise<{
  ok: boolean;
  notes: string[];
}> {
  const notes: string[] = [];
  if (await postfixMainCfMissing(host)) {
    const r = await ensurePostfixMainCf(host);
    notes.push(...r.notes);
    if (!r.ok) return { ok: false, notes };
  }
  // Best-effort: empty setgid_group breaks postqueue; do not fail start prep if postconf soft-fails
  try {
    const gid = await ensurePostfixSetgidGroup(host);
    notes.push(...gid.notes);
  } catch (e) {
    notes.push(
      `setgid_group ensure skipped: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return { ok: true, notes };
}

/**
 * Heal queue tooling when Postfix is installed but not ready:
 * - empty setgid_group
 * - missing spool dirs (hold/incoming/…) → postsuper/postqueue fail
 * - master/showq down → "Mail system is down"
 *
 * Creates queue tree via `postfix check`, then enables/starts unit.
 */
export async function ensurePostfixRuntimeForQueue(
  host: HostExecutor,
): Promise<{ ok: boolean; notes: string[]; started: boolean }> {
  const notes: string[] = [];
  if (!host.executeEnabled()) {
    return {
      ok: false,
      started: false,
      notes: ['postfix queue heal needs YSK_EXECUTE'],
    };
  }

  try {
    const main = await ensurePostfixMainCf(host);
    notes.push(...main.notes);
    // Continue even if main.cf missing — start may still clarify failure notes
  } catch (e) {
    notes.push(
      `main.cf ensure: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  try {
    const gid = await ensurePostfixSetgidGroup(host);
    notes.push(...gid.notes);
  } catch (e) {
    notes.push(
      `setgid_group: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Create missing queue subdirs (hold, deferred, …) and fix ownership
  const check = await host.runCommand(
    [
      'bash',
      '-c',
      [
        'set +e',
        'QD="$(postconf -h queue_directory 2>/dev/null || echo /var/spool/postfix)"',
        'QD="${QD:-/var/spool/postfix}"',
        'mkdir -p "$QD"',
        'for d in active bounce corrupt defer deferred flush hold incoming maildrop private public saved trace; do',
        '  mkdir -p "$QD/$d"',
        'done',
        'postfix set-permissions 2>/dev/null || true',
        'postfix check 2>&1 | tail -30',
        'exit 0',
      ].join('\n'),
    ],
    { timeoutMs: 45_000 },
  );
  const checkOut = (check.stdout || check.stderr || '').trim();
  if (checkOut) notes.push(`postfix check: ${checkOut.slice(0, 240)}`);
  else notes.push('postfix spool dirs ensured');

  let started = false;
  const st = await host.runCommand(
    [
      'bash',
      '-c',
      [
        'set +e',
        'systemctl enable postfix 2>/dev/null || true',
        'systemctl start postfix 2>/dev/null || postfix start 2>/dev/null || true',
        'systemctl is-active postfix 2>/dev/null || echo inactive',
      ].join('\n'),
    ],
    { timeoutMs: 45_000 },
  );
  const active = (st.stdout || st.stderr || '').trim().split('\n').pop() || '';
  if (active === 'active' || active === 'running') {
    started = true;
    notes.push('postfix service active');
  } else {
    notes.push(`postfix service state: ${active || 'unknown'}`);
  }

  return { ok: true, started, notes };
}
