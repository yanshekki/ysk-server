/**
 * Debian/Ubuntu MySQL FROZEN mode — blocks daemon after MySQL↔MariaDB switch/downgrade.
 * See /etc/mysql/FROZEN (often a symlink under /usr/share/mysql/).
 */

import { tl } from '@ysk-server/shared';
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
 * After MySQL↔MariaDB switch, residual config kills the daemon:
 * - my.cnf still points at MariaDB (or vice versa)
 * - MariaDB plugin.provider_* cnf loaded by MySQL 8 → crash
 */
export async function sanitizeSqlConfigForFlavor(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
): Promise<{ ok: boolean; notes: string[] }> {
  const script =
    flavor === 'mysql'
      ? `
set -e
# Point alternatives my.cnf at Oracle MySQL config
if [ -f /etc/mysql/mysql.cnf ]; then
  if [ -x /usr/bin/update-alternatives ]; then
    /usr/bin/update-alternatives --install /etc/mysql/my.cnf my.cnf /etc/mysql/mysql.cnf 200 2>/dev/null || true
    /usr/bin/update-alternatives --set my.cnf /etc/mysql/mysql.cnf 2>/dev/null || true
  fi
  if [ -L /etc/alternatives/my.cnf ] || [ -e /etc/alternatives/my.cnf ]; then
    ln -sfn /etc/mysql/mysql.cnf /etc/alternatives/my.cnf 2>/dev/null || true
  fi
  # Prefer direct mysql.cnf if alternatives broken
  if [ -L /etc/mysql/my.cnf ]; then
    cur=$(readlink -f /etc/mysql/my.cnf 2>/dev/null || true)
    case "$cur" in
      *mariadb*) ln -sfn /etc/mysql/mysql.cnf /etc/mysql/my.cnf 2>/dev/null || true ;;
    esac
  fi
fi
# Disable MariaDB conf.d / plugin providers that MySQL 8 cannot load
ts=$(date +%Y%m%d%H%M%S)
if [ -d /etc/mysql/mariadb.conf.d ]; then
  mkdir -p /etc/mysql/mariadb.conf.d.ysk-disabled-$ts
  # provider_* and other .cnf that crash mysqld
  for f in /etc/mysql/mariadb.conf.d/*.cnf /etc/mysql/mariadb.conf.d/*provider*; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    mv "$f" "/etc/mysql/mariadb.conf.d.ysk-disabled-$ts/$base" 2>/dev/null || true
  done
fi
# conf.d leftovers
for f in /etc/mysql/conf.d/*provider* /etc/mysql/conf.d/*mariadb*; do
  [ -e "$f" ] || continue
  mv "$f" "$f.ysk-disabled" 2>/dev/null || true
done
# Ensure active my.cnf does not include mariadb.conf.d
if [ -f /etc/mysql/mysql.cnf ]; then
  # mysql.cnf should only include conf.d + mysql.conf.d (stock)
  true
fi
echo CONFIG_OK
readlink -f /etc/mysql/my.cnf 2>/dev/null || true
`
      : `
set -e
# Point at MariaDB config when present
if [ -f /etc/mysql/mariadb.cnf ]; then
  if [ -x /usr/bin/update-alternatives ]; then
    /usr/bin/update-alternatives --install /etc/mysql/my.cnf my.cnf /etc/mysql/mariadb.cnf 200 2>/dev/null || true
    /usr/bin/update-alternatives --set my.cnf /etc/mysql/mariadb.cnf 2>/dev/null || true
  fi
  ln -sfn /etc/mysql/mariadb.cnf /etc/alternatives/my.cnf 2>/dev/null || true
fi
echo CONFIG_OK
readlink -f /etc/mysql/my.cnf 2>/dev/null || true
`;

  const r = await host.runCommand(['bash', '-c', script], { timeoutMs: 30_000 });
  if (r.exitCode !== 0 && !(r.stdout || '').includes('CONFIG_OK')) {
    return {
      ok: false,
      notes: [
        tl('sqlEngineSwitch.note.configSanitizeFailed', {
          detail: (r.stderr || r.stdout).trim().slice(0, 300),
        }),
      ],
    };
  }
  const target = (r.stdout || '').split('\n').filter(Boolean).pop() || '';
  return {
    ok: true,
    notes: [
      tl('sqlEngineSwitch.note.configSanitized', {
        flavor,
        target: target || 'ok',
      }),
    ],
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
 * Full repair via generic sql-engine-health pipeline (findings → plan → execute).
 * Mass-market: any combination of freeze / config residue / empty datadir / unit failed.
 */
export async function recoverMysqlAfterEngineSwitch(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
  _opts?: { forceInitEmpty?: boolean },
): Promise<{
  ok: boolean;
  notes: string[];
  steps: Array<{ name: string; status: string; detail?: string }>;
  frozenBefore?: boolean;
  initialized?: boolean;
}> {
  const { diagnoseSqlEngine } = await import('../sql-engine-health/diagnose.js');
  const { executeSqlEngineRepair } = await import('../sql-engine-health/execute.js');
  const before = await diagnoseSqlEngine(host, flavor);
  const r = await executeSqlEngineRepair({
    host,
    flavor,
    confirm: true,
    report: before,
  });
  return {
    ok: r.ok,
    notes: r.notes,
    steps: r.steps.map((s) => ({
      name: s.id,
      status: s.status,
      detail: s.detail,
    })),
    frozenBefore: before.frozen,
    initialized: before.datadirUninitialized && r.ok,
  };
}

/**
 * Explicit operator-confirmed repair (API). Generic health pipeline.
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
  const { executeSqlEngineRepair } = await import('../sql-engine-health/execute.js');
  const r = await executeSqlEngineRepair({
    host,
    flavor,
    confirm: opts?.confirm === true,
  });
  return {
    ok: r.ok,
    blocked: r.blocked,
    blockMessage: r.blockMessage,
    notes: r.notes,
    steps: r.steps.map((s) => ({
      name: s.id,
      status: s.status,
      detail: s.detail,
    })),
    code: r.code,
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
