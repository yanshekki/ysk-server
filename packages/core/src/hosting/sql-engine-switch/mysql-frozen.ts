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
  // Symlink may exist even when target is empty / unreadable — never treat empty cat as "not frozen"
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `
p=${JSON.stringify(path)}
if [ -L "$p" ] || [ -e "$p" ]; then
  echo "__FROZEN_PRESENT__"
  cat "$p" 2>/dev/null || true
  echo
  readlink -f "$p" 2>/dev/null || ls -la "$p" 2>/dev/null || true
else
  echo "__FROZEN_ABSENT__"
fi
`,
    ],
    { timeoutMs: 5_000 },
  );
  const out = r.stdout || '';
  if (!out.includes('__FROZEN_PRESENT__')) {
    // Journal fallback: daemon may log freeze without readable marker in some setups
    const j = await host.runCommand(
      [
        'bash',
        '-c',
        `journalctl -u mysql -u mariadb -n 30 --no-pager 2>/dev/null | grep -i frozen | head -3 || true`,
      ],
      { timeoutMs: 8_000 },
    );
    const jline = (j.stdout || '').trim();
    if (jline) {
      return {
        frozen: true,
        path,
        content: jline.slice(0, 600),
        modeHint: /downgrade/i.test(jline) ? 'downgrade' : 'frozen',
      };
    }
    return { frozen: false, path, content: '' };
  }
  const raw = out.replace('__FROZEN_PRESENT__', '').trim();
  const modeHint = /downgrade/i.test(raw)
    ? 'downgrade'
    : /frozen/i.test(raw)
      ? 'frozen'
      : 'frozen';
  return {
    frozen: true,
    path,
    content: (raw || 'FROZEN marker present').slice(0, 600),
    modeHint,
  };
}

/** True when datadir has no usable system tables (safe to re-initialize). */
export async function isMysqlDatadirEmptyOrUninitialized(host: HostExecutor): Promise<boolean> {
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `
d=${JSON.stringify(DATADIR)}
if [ ! -d "$d" ]; then echo empty; exit 0; fi
# Real system catalog = initialized
if [ -d "$d/mysql" ] && [ "$(ls -A "$d/mysql" 2>/dev/null | head -1)" ]; then
  echo has_data
  exit 0
fi
# ibdata1 alone without mysql/ often means broken half-init — treat as uninit for recovery
if [ -d "$d/mysql" ]; then
  echo has_data
  exit 0
fi
echo empty
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
  // Remove symlink or file; also common alternate markers
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `
rm -f /etc/mysql/FROZEN /etc/mysql/FROZEN.bak 2>/dev/null || true
# Some images use debian.cnf side-effects only; ensure marker gone
if [ -L /etc/mysql/FROZEN ] || [ -e /etc/mysql/FROZEN ]; then
  echo CLEAR_FAIL
  ls -la /etc/mysql/FROZEN 2>&1 || true
  exit 1
fi
echo CLEAR_OK
`,
    ],
    { timeoutMs: 5_000 },
  );
  if (r.exitCode !== 0 || (r.stdout || '').includes('CLEAR_FAIL')) {
    return {
      ok: false,
      notes: [tl('sqlEngineSwitch.note.frozenClearFailed', { path: FROZEN_PATH })],
    };
  }
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
