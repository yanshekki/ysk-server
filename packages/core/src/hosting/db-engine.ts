import { tl } from 'ysk-server-shared';
/**
 * MySQL vs MariaDB engine probe / install / start — panel only.
 * Presence/version always via HostSoftwareProbe (never ad-hoc command -v).
 */

import type { HostExecutor } from '../host/executor.js';
import { panelBlockMessage, type BlockReason } from './system-apply.js';
import { installSoftware } from './software-install.js';
import { HostSoftwareProbe } from './software-probe/index.js';

export type DbEngineKind = 'mysql' | 'mariadb';

export interface DbEngineStatus {
  engine: DbEngineKind;
  title: string;
  clientInstalled: boolean;
  serverInstalled: boolean;
  unit: string;
  active: string;
  version?: string;
  executeEnabled: boolean;
  isRoot: boolean;
  canProvision: boolean;
  canInstall: boolean;
  blockMessage?: string;
  /** When true, host runs the other SQL engine exclusively */
  blockedByExclusive?: string;
  frozen?: boolean;
  frozenMode?: string;
  datadirEmpty?: boolean;
}

export async function probeDbEngine(
  host: HostExecutor,
  engine: DbEngineKind,
): Promise<DbEngineStatus> {
  const title = engine === 'mysql' ? 'MySQL' : 'MariaDB';
  const unit = engine === 'mysql' ? 'mysql' : 'mariadb';
  const serverId = engine === 'mysql' ? 'mysql-server' : 'mariadb-server';
  const probe = new HostSoftwareProbe(host);

  const server = await probe.presence(serverId);
  const client = await probe.presence('mysql-client');
  const ver = await probe.version(serverId);
  // client version often available even when server exclusive-blocked
  const clientVer = await probe.version('mysql-client');

  let active = 'not_installed';
  if (server.installed && server.units?.[0]?.active) {
    active = server.units[0].active ?? 'unknown';
  } else if (server.installed) {
    // unit list may be empty if unit not registered; re-check via presence units
    const u = server.units?.find((x) => x.name === unit);
    active = u?.active ?? 'unknown';
  }
  if (server.installed && active !== 'active' && engine === 'mysql') {
    // mysqld unit alias on some distros
    const alt = await host.runCommand(['systemctl', 'is-active', 'mysqld'], { timeoutMs: 5_000 });
    const a = (alt.stdout || alt.stderr || '').trim().split('\n')[0];
    if (a === 'active') active = a;
  }

  const executeEnabled = host.executeEnabled();
  const isRoot = host.isRoot();
  const canInstall = executeEnabled && isRoot;
  const canProvision =
    client.installed && executeEnabled && server.installed && active === 'active';

  let frozen = false;
  let frozenMode: string | undefined;
  let datadirEmpty: boolean | undefined;
  // Mass-market health report (findings catalog — not only FROZEN)
  let healthFindings: Array<{ id: string; severity: string; messageKey: string }> = [];
  if (server.installed && (engine === 'mysql' || engine === 'mariadb')) {
    try {
      const { diagnoseSqlEngine } = await import('./sql-engine-health/diagnose.js');
      const health = await diagnoseSqlEngine(host, engine);
      frozen = health.frozen;
      frozenMode = health.frozenMode;
      datadirEmpty = health.datadirUninitialized;
      if (health.active && health.active !== 'not_installed') {
        active = health.active;
      }
      healthFindings = health.findings.map((f) => ({
        id: f.id,
        severity: f.severity,
        messageKey: f.messageKey,
      }));
    } catch {
      try {
        const { readMysqlFrozen, isMysqlDatadirEmptyOrUninitialized } = await import(
          './sql-engine-switch/mysql-frozen.js'
        );
        const fr = await readMysqlFrozen(host);
        frozen = fr.frozen;
        frozenMode = fr.modeHint;
        datadirEmpty = await isMysqlDatadirEmptyOrUninitialized(host);
      } catch {
        /* optional */
      }
    }
  }

  let blockMessage: string | undefined;
  if (!executeEnabled) {
    blockMessage = panelBlockMessage('no_execute');
  } else if (!server.installed) {
    if (server.blockedByExclusive) {
      blockMessage = tl('notes.auto.t0245', { v0: title });
    } else {
      blockMessage = tl('notes.auto.t0245', { v0: title });
    }
  } else if (frozen && active !== 'active') {
    blockMessage = tl('sqlEngineSwitch.note.frozenShort', {
      mode: frozenMode || 'frozen',
    });
  } else if (active !== 'active') {
    blockMessage = tl('notes.auto.t0246', { v0: title });
  } else if (!client.installed) {
    blockMessage = tl('notes.auto.t0247', { v0: title });
  }

  return {
    engine,
    title,
    clientInstalled: client.installed,
    serverInstalled: server.installed,
    unit,
    active: server.installed ? active : 'not_installed',
    version: ver.version || clientVer.version,
    executeEnabled,
    isRoot,
    canProvision,
    canInstall,
    blockMessage: canProvision ? undefined : blockMessage,
    blockedByExclusive: server.blockedByExclusive,
    frozen,
    frozenMode,
    datadirEmpty,
    /** Generic findings for UI (sqlEngineHealth.finding.*) */
    healthFindings,
  } as DbEngineStatus & {
    healthFindings?: Array<{ id: string; severity: string; messageKey: string }>;
  };
}

/** Operator-confirmed unfreeze + start (empty datadir re-init when safe). */
export async function unfreezeDbEngine(input: {
  host: HostExecutor;
  engine: DbEngineKind;
  confirm: boolean;
}): Promise<{
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  steps?: Array<{ name: string; status: string; detail?: string }>;
  code?: string;
  status: DbEngineStatus;
}> {
  const { unfreezeMysqlEngine } = await import('./sql-engine-switch/mysql-frozen.js');
  const r = await unfreezeMysqlEngine(input.host, input.engine, { confirm: input.confirm });
  const status = await probeDbEngine(input.host, input.engine);
  return {
    ok: r.ok && status.active === 'active',
    blocked: r.blocked,
    blockMessage: r.blockMessage,
    notes: r.notes,
    steps: r.steps,
    code: r.code,
    status,
  };
}

export async function installDbEngine(input: {
  host: HostExecutor;
  engine: DbEngineKind;
  dataDir?: string;
}): Promise<{
  ok: boolean;
  executed: boolean;
  blocked?: boolean;
  blockReason?: BlockReason;
  blockMessage?: string;
  notes: string[];
  status: DbEngineStatus;
  steps: Array<{ name: string; status: string; detail?: string }>;
}> {
  const clientId = 'mysql-client';
  const serverId = input.engine === 'mysql' ? 'mysql-server' : 'mariadb-server';

  const steps: Array<{ name: string; status: string; detail?: string }> = [];
  const notes: string[] = [];

  const client = await installSoftware({
    host: input.host,
    id: clientId,
    dataDir: input.dataDir,
    enableUnits: false,
  });
  steps.push(
    ...(client.steps ?? []).map((s) => ({
      name: tl('notes.auto.t0248', { v0: s.name }),
      status: s.status,
      detail: s.detail,
    })),
  );
  notes.push(...client.notes);

  const server = await installSoftware({
    host: input.host,
    id: serverId,
    dataDir: input.dataDir,
    enableUnits: true,
  });
  steps.push(
    ...(server.steps ?? []).map((s) => ({
      name: tl('notes.auto.t0249', { v0: s.name }),
      status: s.status,
      detail: s.detail,
    })),
  );
  notes.push(...server.notes);

  const status = await probeDbEngine(input.host, input.engine);
  const blocked = Boolean(client.blocked || server.blocked);
  const ok = status.serverInstalled && (status.active === 'active' || server.ok);

  return {
    ok: ok && !blocked,
    executed: Boolean(client.executed || server.executed),
    blocked,
    blockReason: client.blockReason ?? server.blockReason,
    blockMessage: client.blockMessage ?? server.blockMessage,
    notes: notes.length
      ? notes
      : ok
        ? [tl('notes.auto.t0250', { v0: status.title })]
        : [tl('notes.auto.t0251', { v0: status.title })],
    status,
    steps,
  };
}

export async function startDbEngine(input: {
  host: HostExecutor;
  engine: DbEngineKind;
}): Promise<{
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  status: DbEngineStatus;
  code?: string;
}> {
  const unit = input.engine === 'mysql' ? 'mysql' : 'mariadb';
  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    const reason: BlockReason = !input.host.executeEnabled() ? 'no_execute' : 'no_root';
    const blockMessage = panelBlockMessage(reason);
    return {
      ok: false,
      blocked: true,
      blockMessage,
      notes: [blockMessage],
      status: await probeDbEngine(input.host, input.engine),
    };
  }
  const notes: string[] = [];
  // enable separately — systemd-sysv-install noise must not hide start/FROZEN failures
  await input.host.runCommand(['systemctl', 'enable', unit], { timeoutMs: 60_000 });
  let start = await input.host.runCommand(['systemctl', 'start', unit], { timeoutMs: 120_000 });
  let status = await probeDbEngine(input.host, input.engine);

  // Any start failure for SQL server: always run full recovery (stop/clear FROZEN/init empty/start)
  if (status.active !== 'active') {
    try {
      const { recoverMysqlAfterEngineSwitch } = await import('./sql-engine-switch/mysql-frozen.js');
      const rec = await recoverMysqlAfterEngineSwitch(input.host, input.engine);
      notes.push(...rec.notes);
      status = await probeDbEngine(input.host, input.engine);
      if (status.active !== 'active') {
        start = await input.host.runCommand(['systemctl', 'start', unit], { timeoutMs: 120_000 });
        status = await probeDbEngine(input.host, input.engine);
      }
    } catch (e) {
      notes.push(String(e instanceof Error ? e.message : e));
    }
  }

  const ok = status.active === 'active';
  if (ok) {
    notes.push(tl('notes.auto.t0252', { v0: status.title }));
  } else {
    const detail = (start.stderr || start.stdout || status.active || '').trim();
    notes.push(tl('notes.auto.t0253', { v0: detail.slice(0, 500) }));
    notes.push(tl('sqlEngineSwitch.note.unfreezePrompt'));
  }
  return {
    ok,
    notes,
    status,
    code: !ok ? 'needs_unfreeze' : undefined,
  };
}
