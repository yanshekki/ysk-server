/**
 * Debian/Ubuntu MySQL FROZEN mode — blocks daemon after MySQL↔MariaDB switch/downgrade.
 * See /etc/mysql/FROZEN (often a symlink under /usr/share/mysql/).
 */

import { tl } from '@ysk/shared';
import type { HostExecutor } from '../../host/executor.js';

const FROZEN_PATH = '/etc/mysql/FROZEN';
const DATADIR = '/var/lib/mysql';

export type MysqlFrozenInfo = {
  frozen: boolean;
  path: string;
  /** First lines of FROZEN file for operator notes */
  content: string;
  /** e.g. frozen-mode/downgrade when path ends with that */
  modeHint?: string;
};

export async function readMysqlFrozen(host: HostExecutor): Promise<MysqlFrozenInfo> {
  const path = FROZEN_PATH;
  // pathExists may be false for dangling symlink; still try read via cat
  const r = await host.runCommand(
    ['bash', '-c', `if [ -e ${JSON.stringify(path)} ] || [ -L ${JSON.stringify(path)} ]; then cat ${JSON.stringify(path)} 2>/dev/null; echo; ls -la ${JSON.stringify(path)} 2>/dev/null; else echo ''; fi`],
    { timeoutMs: 5_000 },
  );
  const raw = (r.stdout || '').trim();
  if (!raw) {
    return { frozen: false, path, content: '' };
  }
  // present if file/symlink exists
  const exists = await host.runCommand(
    ['bash', '-c', `if [ -e ${JSON.stringify(path)} ] || [ -L ${JSON.stringify(path)} ]; then echo yes; fi`],
    { timeoutMs: 3_000 },
  );
  if (exists.stdout.trim() !== 'yes') {
    return { frozen: false, path, content: '' };
  }
  const modeHint = raw.includes('downgrade')
    ? 'downgrade'
    : raw.includes('frozen')
      ? 'frozen'
      : undefined;
  return {
    frozen: true,
    path,
    content: raw.slice(0, 600),
    modeHint,
  };
}

/** True when datadir has no system tables (safe to re-initialize). */
export async function isMysqlDatadirEmptyOrUninitialized(host: HostExecutor): Promise<boolean> {
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `
d=${JSON.stringify(DATADIR)}
if [ ! -d "$d" ]; then echo empty; exit 0; fi
# system tables markers
if [ -d "$d/mysql" ] || [ -f "$d/ibdata1" ] || [ -d "$d/performance_schema" ] || [ -d "$d/sys" ]; then
  echo has_data
  exit 0
fi
# only lost+found / empty / FROZEN leftovers
cnt=$(find "$d" -mindepth 1 -maxdepth 1 ! -name lost+found 2>/dev/null | wc -l)
if [ "$cnt" -eq 0 ]; then echo empty; else echo has_data; fi
`,
    ],
    { timeoutMs: 10_000 },
  );
  return r.stdout.trim().includes('empty');
}

export async function clearMysqlFrozen(host: HostExecutor): Promise<{ ok: boolean; notes: string[] }> {
  const info = await readMysqlFrozen(host);
  if (!info.frozen) {
    return { ok: true, notes: [] };
  }
  const r = await host.runCommand(
    ['bash', '-c', `rm -f ${JSON.stringify(FROZEN_PATH)} ${JSON.stringify(FROZEN_PATH + '.bak')} 2>/dev/null; true`],
    { timeoutMs: 5_000 },
  );
  const still = await readMysqlFrozen(host);
  if (still.frozen) {
    return {
      ok: false,
      notes: [tl('sqlEngineSwitch.note.frozenClearFailed', { path: FROZEN_PATH })],
    };
  }
  void r;
  return {
    ok: true,
    notes: [tl('sqlEngineSwitch.note.frozenCleared', { path: FROZEN_PATH })],
  };
}

/**
 * Initialize empty datadir for MySQL 8 / MariaDB when safe (no system tables).
 */
export async function initializeMysqlDatadirIfEmpty(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
): Promise<{ ok: boolean; notes: string[]; initialized: boolean }> {
  const empty = await isMysqlDatadirEmptyOrUninitialized(host);
  if (!empty) {
    return {
      ok: true,
      initialized: false,
      notes: [tl('sqlEngineSwitch.note.datadirNotEmptySkipInit')],
    };
  }
  // Absolute paths only (software-probe SSOT forbids raw command -v outside probe/)
  const safeScript =
    flavor === 'mariadb'
      ? `
set -e
mkdir -p /var/lib/mysql
chown mysql:mysql /var/lib/mysql 2>/dev/null || true
if [ -x /usr/bin/mariadb-install-db ]; then
  /usr/bin/mariadb-install-db --user=mysql --datadir=/var/lib/mysql 2>&1
elif [ -x /usr/sbin/mysqld ]; then
  /usr/sbin/mysqld --initialize-insecure --user=mysql --datadir=/var/lib/mysql 2>&1
elif [ -x /usr/sbin/mariadbd ]; then
  /usr/sbin/mariadbd --initialize-insecure --user=mysql --datadir=/var/lib/mysql 2>&1
else
  echo "no install-db / mysqld" >&2
  exit 2
fi
`
      : `
set -e
mkdir -p /var/lib/mysql
chown mysql:mysql /var/lib/mysql 2>/dev/null || true
if [ -x /usr/sbin/mysqld ]; then
  /usr/sbin/mysqld --initialize-insecure --user=mysql --datadir=/var/lib/mysql 2>&1
else
  echo "mysqld not found" >&2
  exit 2
fi
`;
  const r = await host.runCommand(['bash', '-c', safeScript], { timeoutMs: 180_000 });
  if (r.exitCode !== 0) {
    return {
      ok: false,
      initialized: false,
      notes: [
        tl('sqlEngineSwitch.note.datadirInitFailed', {
          detail: (r.stderr || r.stdout).trim().slice(0, 400),
        }),
      ],
    };
  }
  return {
    ok: true,
    initialized: true,
    notes: [tl('sqlEngineSwitch.note.datadirInitialized', { flavor })],
  };
}

/**
 * Clear FROZEN + init empty datadir + reset-failed unit (for switch / install recovery).
 * Order: stop → clear freeze → init empty datadir → reset-failed → start (not enable --now).
 */
export async function recoverMysqlAfterEngineSwitch(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
  opts?: { forceInitEmpty?: boolean },
): Promise<{
  ok: boolean;
  notes: string[];
  steps: Array<{ name: string; status: string; detail?: string }>;
  frozenBefore?: boolean;
  initialized?: boolean;
}> {
  const steps: Array<{ name: string; status: string; detail?: string }> = [];
  const notes: string[] = [];
  const unit = flavor === 'mysql' ? 'mysql' : 'mariadb';

  await host.runCommand(['systemctl', 'stop', unit], { timeoutMs: 60_000 });
  steps.push({ name: tl('sqlEngineSwitch.step.stop', { unit }), status: 'ok' });

  const frozen = await readMysqlFrozen(host);
  if (frozen.frozen) {
    notes.push(
      tl('sqlEngineSwitch.note.frozenDetected', {
        path: frozen.path,
        mode: frozen.modeHint || 'frozen',
        snippet: frozen.content.replace(/\s+/g, ' ').slice(0, 160),
      }),
    );
    const c = await clearMysqlFrozen(host);
    notes.push(...c.notes);
    steps.push({
      name: tl('sqlEngineSwitch.step.clearFrozen'),
      status: c.ok ? 'ok' : 'failed',
      detail: frozen.modeHint || frozen.content.slice(0, 120),
    });
    if (!c.ok) return { ok: false, notes, steps, frozenBefore: true };
  } else {
    steps.push({ name: tl('sqlEngineSwitch.step.clearFrozen'), status: 'skipped', detail: 'not frozen' });
  }

  // Always try init when empty (or force). Non-empty with freeze only: just clear freeze + start.
  const empty = await isMysqlDatadirEmptyOrUninitialized(host);
  let initialized = false;
  if (empty || opts?.forceInitEmpty) {
    if (!empty && opts?.forceInitEmpty) {
      // force only when explicitly empty check failed but caller insists — still refuse if has system tables
      notes.push(tl('sqlEngineSwitch.note.datadirNotEmptySkipInit'));
    }
    const init = await initializeMysqlDatadirIfEmpty(host, flavor);
    notes.push(...init.notes);
    initialized = init.initialized;
    steps.push({
      name: tl('sqlEngineSwitch.step.initDatadir'),
      status: init.ok ? (init.initialized ? 'ok' : 'skipped') : 'failed',
    });
    if (!init.ok) return { ok: false, notes, steps, frozenBefore: frozen.frozen, initialized };
  } else {
    steps.push({
      name: tl('sqlEngineSwitch.step.initDatadir'),
      status: 'skipped',
      detail: 'datadir has data',
    });
  }

  await host.runCommand(['systemctl', 'reset-failed', unit], { timeoutMs: 10_000 });
  await host.runCommand(['systemctl', 'enable', unit], { timeoutMs: 60_000 });
  const start = await host.runCommand(['systemctl', 'start', unit], { timeoutMs: 120_000 });
  const active = await host.runCommand(['systemctl', 'is-active', unit], { timeoutMs: 5_000 });
  const isActive = (active.stdout || active.stderr || '').trim().startsWith('active');
  steps.push({
    name: tl('sqlEngineSwitch.step.startUnit', { unit }),
    status: isActive ? 'ok' : 'failed',
    detail: isActive
      ? undefined
      : (start.stderr || start.stdout || active.stdout || 'not active').slice(0, 300),
  });

  if (!isActive) {
    notes.push(
      tl('sqlEngineSwitch.note.unfreezeStartFailed', {
        detail: (start.stderr || start.stdout || active.stdout || unit).trim().slice(0, 400),
      }),
    );
  } else {
    notes.push(tl('sqlEngineSwitch.note.unfreezeOk', { unit }));
  }

  return {
    ok: isActive,
    notes,
    steps,
    frozenBefore: frozen.frozen,
    initialized,
  };
}

/**
 * Explicit operator-confirmed unfreeze (API). Same as recover but requires caller to pass confirm.
 */
export async function unfreezeMysqlEngine(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
  opts?: { confirm?: boolean },
): Promise<{
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  steps: Array<{ name: string; status: string; detail?: string }>;
  code?: string;
}> {
  if (!host.executeEnabled() || !host.isRoot()) {
    const reason = !host.executeEnabled() ? 'no_execute' : 'no_root';
    const { panelBlockMessage } = await import('../system-apply.js');
    const blockMessage = panelBlockMessage(reason);
    return { ok: false, blocked: true, blockMessage, notes: [blockMessage], steps: [] };
  }
  if (opts?.confirm !== true) {
    const frozen = await readMysqlFrozen(host);
    const empty = await isMysqlDatadirEmptyOrUninitialized(host);
    return {
      ok: false,
      code: 'needs_confirm',
      notes: [
        tl('sqlEngineSwitch.note.unfreezeNeedsConfirm', {
          frozen: frozen.frozen ? 'yes' : 'no',
          empty: empty ? 'yes' : 'no',
        }),
      ],
      steps: [],
    };
  }
  return recoverMysqlAfterEngineSwitch(host, flavor);
}

/** Operator-facing hint when unit failed due to FROZEN. */
export async function frozenUnitFailureHint(
  host: HostExecutor,
  unit: string,
): Promise<string | undefined> {
  if (unit !== 'mysql' && unit !== 'mysqld' && unit !== 'mariadb') return undefined;
  const info = await readMysqlFrozen(host);
  if (!info.frozen) return undefined;
  return tl('sqlEngineSwitch.note.frozenDetected', {
    path: info.path,
    mode: info.modeHint || 'frozen',
    snippet: info.content.replace(/\s+/g, ' ').slice(0, 200),
  });
}
