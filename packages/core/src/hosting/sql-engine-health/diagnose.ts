/**
 * Diagnose MySQL/MariaDB host state → findings + repair plan.
 * Mass-market: one report for install/start/switch failures, not ad-hoc if/else per bug.
 */

import type { HostExecutor } from '../../host/executor.js';
import {
  readMysqlFrozen,
  isMysqlDatadirEmptyOrUninitialized,
} from '../sql-engine-switch/mysql-frozen.js';
import { HostSoftwareProbe } from '../software-probe/index.js';
import type {
  SqlEngineFlavor,
  SqlEngineHealthReport,
  SqlFinding,
  SqlRepairAction,
  SqlFindingId,
} from './types.js';

function unitName(flavor: SqlEngineFlavor): string {
  return flavor === 'mysql' ? 'mysql' : 'mariadb';
}

function serverId(flavor: SqlEngineFlavor): string {
  return flavor === 'mysql' ? 'mysql-server' : 'mariadb-server';
}

async function readActive(host: HostExecutor, unit: string): Promise<string> {
  const r = await host.runCommand(['systemctl', 'is-active', unit], { timeoutMs: 5_000 });
  return (r.stdout || r.stderr || 'unknown').trim().split(/\s+/)[0] || 'unknown';
}

async function readConfigTarget(host: HostExecutor): Promise<string> {
  const r = await host.runCommand(
    ['bash', '-c', 'readlink -f /etc/mysql/my.cnf 2>/dev/null || readlink -f /etc/alternatives/my.cnf 2>/dev/null || echo unknown'],
    { timeoutMs: 5_000 },
  );
  return (r.stdout || '').trim() || 'unknown';
}

async function hasForeignPluginCnf(
  host: HostExecutor,
  flavor: SqlEngineFlavor,
): Promise<{ yes: boolean; evidence: string }> {
  // MySQL must not load MariaDB provider_*; MariaDB rarely loads mysql-only snippets
  const script =
    flavor === 'mysql'
      ? `
hits=""
for d in /etc/mysql/mariadb.conf.d /etc/mysql/conf.d; do
  [ -d "$d" ] || continue
  for f in "$d"/*provider* "$d"/*mariadb*; do
    [ -e "$f" ] || continue
    hits="$hits $f"
  done
done
# my.cnf points at mariadb
cur=$(readlink -f /etc/mysql/my.cnf 2>/dev/null || true)
case "$cur" in *mariadb*) hits="$hits my.cnf->$cur" ;; esac
if [ -n "$hits" ]; then echo "YES|$hits"; else echo "NO|"; fi
`
      : `
hits=""
cur=$(readlink -f /etc/mysql/my.cnf 2>/dev/null || true)
case "$cur" in *mysql.cnf|*mysql.conf*) hits="$hits my.cnf->$cur" ;; esac
if [ -n "$hits" ]; then echo "YES|$hits"; else echo "NO|"; fi
`;
  const r = await host.runCommand(['bash', '-c', script], { timeoutMs: 8_000 });
  const line = (r.stdout || '').trim();
  if (line.startsWith('YES|')) {
    return { yes: true, evidence: line.slice(4).trim().slice(0, 200) };
  }
  return { yes: false, evidence: '' };
}

async function port3306Busy(host: HostExecutor): Promise<{ yes: boolean; evidence: string }> {
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `ss -tlnp 2>/dev/null | grep -E ':3306\\b' | head -2 || netstat -tlnp 2>/dev/null | grep 3306 | head -2 || true`,
    ],
    { timeoutMs: 5_000 },
  );
  const line = (r.stdout || '').trim();
  if (!line) return { yes: false, evidence: '' };
  // if our unit is active, port busy is expected — caller filters
  return { yes: true, evidence: line.slice(0, 200) };
}

/** Build ordered repair plan from findings (deterministic, flavor-agnostic pipeline). */
export function planRepairFromFindings(findings: SqlFinding[]): SqlRepairAction[] {
  const ids = new Set(findings.map((f) => f.id));
  const plan: SqlRepairAction[] = [];
  const need =
    ids.has('unit_not_active') ||
    ids.has('unit_failed') ||
    ids.has('frozen_marker') ||
    ids.has('datadir_uninitialized') ||
    ids.has('config_flavor_mismatch') ||
    ids.has('residual_foreign_plugins');

  if (!need) return plan;

  const because = (candidates: SqlFindingId[]): SqlFindingId[] =>
    candidates.filter((c) => ids.has(c));

  plan.push({
    id: 'stop_unit',
    because: because([
      'unit_failed',
      'unit_not_active',
      'frozen_marker',
      'datadir_uninitialized',
      'config_flavor_mismatch',
      'residual_foreign_plugins',
    ]),
    requiresConfirm: true,
    messageKey: 'sqlEngineHealth.action.stop_unit',
  });

  if (ids.has('frozen_marker')) {
    plan.push({
      id: 'clear_frozen',
      because: ['frozen_marker'],
      requiresConfirm: true,
      messageKey: 'sqlEngineHealth.action.clear_frozen',
    });
  }

  if (ids.has('config_flavor_mismatch') || ids.has('residual_foreign_plugins')) {
    plan.push({
      id: 'sanitize_config',
      because: because(['config_flavor_mismatch', 'residual_foreign_plugins']),
      requiresConfirm: true,
      messageKey: 'sqlEngineHealth.action.sanitize_config',
    });
  }

  if (ids.has('datadir_uninitialized')) {
    plan.push({
      id: 'init_datadir',
      because: ['datadir_uninitialized'],
      requiresConfirm: true,
      messageKey: 'sqlEngineHealth.action.init_datadir',
    });
  }

  plan.push({
    id: 'reset_failed',
    because: because(['unit_failed', 'unit_not_active', 'frozen_marker']),
    requiresConfirm: true,
    messageKey: 'sqlEngineHealth.action.reset_failed',
  });
  plan.push({
    id: 'enable_unit',
    because: because(['unit_failed', 'unit_not_active']),
    requiresConfirm: true,
    messageKey: 'sqlEngineHealth.action.enable_unit',
  });
  plan.push({
    id: 'start_unit',
    because: because(['unit_failed', 'unit_not_active', 'frozen_marker', 'datadir_uninitialized']),
    requiresConfirm: true,
    messageKey: 'sqlEngineHealth.action.start_unit',
  });
  plan.push({
    id: 'verify_active',
    because: because(['unit_failed', 'unit_not_active']),
    requiresConfirm: false,
    messageKey: 'sqlEngineHealth.action.verify_active',
  });

  return plan;
}

export async function diagnoseSqlEngine(
  host: HostExecutor,
  flavor: SqlEngineFlavor,
): Promise<SqlEngineHealthReport> {
  const unit = unitName(flavor);
  const probe = new HostSoftwareProbe(host);
  const server = await probe.presence(serverId(flavor));
  const client = await probe.presence('mysql-client');
  const active = server.installed ? await readActive(host, unit) : 'not_installed';

  const findings: SqlFinding[] = [];

  if (!server.installed) {
    findings.push({
      id: 'package_missing',
      severity: 'blocker',
      messageKey: 'sqlEngineHealth.finding.package_missing',
      params: { flavor },
    });
  }

  if (!client.installed) {
    findings.push({
      id: 'client_missing',
      severity: 'warn',
      messageKey: 'sqlEngineHealth.finding.client_missing',
    });
  }

  let frozen = false;
  let frozenMode: string | undefined;
  let datadirUninitialized = false;
  let configPointsTo: string | undefined;

  if (server.installed) {
    const fr = await readMysqlFrozen(host);
    frozen = fr.frozen;
    frozenMode = fr.modeHint;
    if (fr.frozen) {
      findings.push({
        id: 'frozen_marker',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.frozen_marker',
        params: { mode: fr.modeHint || 'frozen' },
        evidence: fr.content.slice(0, 200),
      });
    }

    datadirUninitialized = await isMysqlDatadirEmptyOrUninitialized(host);
    if (datadirUninitialized) {
      findings.push({
        id: 'datadir_uninitialized',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.datadir_uninitialized',
      });
    }

    configPointsTo = await readConfigTarget(host);
    const expectsMysql = flavor === 'mysql';
    const pointsMaria = /mariadb/i.test(configPointsTo);
    const pointsMysql = /mysql\.cnf|mysql\.conf/i.test(configPointsTo);
    if (expectsMysql && pointsMaria) {
      findings.push({
        id: 'config_flavor_mismatch',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.config_flavor_mismatch',
        params: { flavor, path: configPointsTo },
        evidence: configPointsTo,
      });
    }
    if (!expectsMysql && pointsMysql && !pointsMaria) {
      findings.push({
        id: 'config_flavor_mismatch',
        severity: 'warn',
        messageKey: 'sqlEngineHealth.finding.config_flavor_mismatch',
        params: { flavor, path: configPointsTo },
        evidence: configPointsTo,
      });
    }

    const foreign = await hasForeignPluginCnf(host, flavor);
    if (foreign.yes) {
      findings.push({
        id: 'residual_foreign_plugins',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.residual_foreign_plugins',
        evidence: foreign.evidence,
      });
    }

    if (active === 'failed') {
      findings.push({
        id: 'unit_failed',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.unit_failed',
        params: { unit },
      });
    } else if (active !== 'active' && active !== 'not_installed') {
      findings.push({
        id: 'unit_not_active',
        severity: 'error',
        messageKey: 'sqlEngineHealth.finding.unit_not_active',
        params: { unit, active },
      });
    }

    if (active !== 'active') {
      const port = await port3306Busy(host);
      if (port.yes) {
        findings.push({
          id: 'port_conflict',
          severity: 'warn',
          messageKey: 'sqlEngineHealth.finding.port_conflict',
          evidence: port.evidence,
        });
      }
    }
  }

  const repairPlan = planRepairFromFindings(findings);
  const healthy =
    server.installed &&
    active === 'active' &&
    !frozen &&
    !findings.some((f) => f.severity === 'error' || f.severity === 'blocker');

  return {
    flavor,
    unit,
    healthy,
    serverInstalled: server.installed,
    clientInstalled: client.installed,
    active,
    findings,
    repairPlan,
    requiresConfirm: repairPlan.some((a) => a.requiresConfirm),
    frozen,
    frozenMode,
    datadirUninitialized,
    configPointsTo,
    executeEnabled: host.executeEnabled(),
    isRoot: host.isRoot(),
  };
}
