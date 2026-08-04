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
 */
export async function recoverMysqlAfterEngineSwitch(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
): Promise<{ ok: boolean; notes: string[]; steps: Array<{ name: string; status: string; detail?: string }> }> {
  const steps: Array<{ name: string; status: string; detail?: string }> = [];
  const notes: string[] = [];

  const frozen = await readMysqlFrozen(host);
  if (frozen.frozen) {
    const c = await clearMysqlFrozen(host);
    notes.push(...c.notes);
    steps.push({
      name: tl('sqlEngineSwitch.step.clearFrozen'),
      status: c.ok ? 'ok' : 'failed',
      detail: frozen.modeHint || frozen.content.slice(0, 120),
    });
    if (!c.ok) return { ok: false, notes, steps };
  } else {
    steps.push({ name: tl('sqlEngineSwitch.step.clearFrozen'), status: 'skipped', detail: 'not frozen' });
  }

  const init = await initializeMysqlDatadirIfEmpty(host, flavor);
  notes.push(...init.notes);
  steps.push({
    name: tl('sqlEngineSwitch.step.initDatadir'),
    status: init.ok ? (init.initialized ? 'ok' : 'skipped') : 'failed',
  });
  if (!init.ok) return { ok: false, notes, steps };

  const unit = flavor === 'mysql' ? 'mysql' : 'mariadb';
  await host.runCommand(['systemctl', 'reset-failed', unit], { timeoutMs: 10_000 });
  const start = await host.runCommand(['systemctl', 'enable', '--now', unit], { timeoutMs: 120_000 });
  steps.push({
    name: tl('sqlEngineSwitch.step.startUnit', { unit }),
    status: start.exitCode === 0 ? 'ok' : 'failed',
    detail: start.exitCode === 0 ? undefined : (start.stderr || start.stdout).slice(0, 200),
  });

  return {
    ok: start.exitCode === 0 || init.ok,
    notes,
    steps,
  };
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
