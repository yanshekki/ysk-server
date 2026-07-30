import { tl } from '@ysk/shared';
/**
 * MySQL vs MariaDB engine probe / install / start — panel only.
 */

import type { HostExecutor } from '../host/executor.js';
import { panelBlockMessage, type BlockReason } from './system-apply.js';
import { installSoftware } from './software-install.js';

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
}

async function hasBin(host: HostExecutor, bin: string): Promise<boolean> {
  const r = await host.runCommand(['bash', '-c', `command -v ${bin} 2>/dev/null || true`], {
    timeoutMs: 5_000,
  });
  return r.stdout.trim().length > 0;
}

async function unitActive(host: HostExecutor, unit: string): Promise<string> {
  if (!host.pathExists('/bin/systemctl') && !host.pathExists('/usr/bin/systemctl')) {
    return 'unknown';
  }
  const r = await host.runCommand(['systemctl', 'is-active', unit], { timeoutMs: 5_000 });
  return (r.stdout || r.stderr || 'unknown').trim().split('\n')[0] || 'unknown';
}

/** Detect if package is likely MariaDB vs Oracle MySQL when both might share mysql CLI */
async function detectServerFlavor(host: HostExecutor): Promise<'mysql' | 'mariadb' | 'none'> {
  const hasMariadbd = await hasBin(host, 'mariadbd');
  if (hasMariadbd) return 'mariadb';
  // dpkg check best-effort
  const pkg = await host.runCommand(
    [
      'bash',
      '-c',
      "dpkg -l 2>/dev/null | awk '/^ii/ && /mariadb-server/ {print \"mariadb\"; exit} /^ii/ && /mysql-server/ {print \"mysql\"; exit}'",
    ],
    { timeoutMs: 10_000 },
  );
  const line = pkg.stdout.trim();
  if (line === 'mariadb' || line === 'mysql') return line;
  const hasMysqld = await hasBin(host, 'mysqld');
  if (hasMysqld) return 'mysql';
  return 'none';
}

export async function probeDbEngine(
  host: HostExecutor,
  engine: DbEngineKind,
): Promise<DbEngineStatus> {
  const title = engine === 'mysql' ? 'MySQL' : 'MariaDB';
  const unit = engine === 'mysql' ? 'mysql' : 'mariadb';
  const clientInstalled =
    (await hasBin(host, 'mysql')) || (await hasBin(host, 'mariadb'));

  const flavor = await detectServerFlavor(host);
  // Server "installed for this engine" only if flavor matches or package unit present
  let serverInstalled = false;
  if (engine === 'mariadb') {
    serverInstalled =
      flavor === 'mariadb' ||
      (await hasBin(host, 'mariadbd')) ||
      (await unitActive(host, 'mariadb')) === 'active';
  } else {
    // MySQL: mysqld present AND not pure MariaDB flavor
    serverInstalled =
      flavor === 'mysql' ||
      ((await hasBin(host, 'mysqld')) && flavor !== 'mariadb');
    // If only mariadb is installed, mysql page shows server not installed
    if (flavor === 'mariadb') serverInstalled = false;
  }

  let active = await unitActive(host, unit);
  // MySQL 8 on Ubuntu often uses mysql.service; MariaDB uses mariadb.service
  if (active !== 'active' && engine === 'mysql') {
    const alt = await unitActive(host, 'mysqld');
    if (alt === 'active') active = alt;
  }

  let version: string | undefined;
  if (clientInstalled) {
    const v = await host.runCommand(
      ['bash', '-c', 'mysql --version 2>/dev/null || mariadb --version 2>/dev/null || true'],
      { timeoutMs: 5_000 },
    );
    version = v.stdout.trim().slice(0, 120) || undefined;
  }

  const executeEnabled = host.executeEnabled();
  const isRoot = host.isRoot();
  const canInstall = executeEnabled && isRoot;
  const canProvision = clientInstalled && executeEnabled && serverInstalled && active === 'active';

  let blockMessage: string | undefined;
  if (!executeEnabled) {
    blockMessage = panelBlockMessage('no_execute');
  } else if (!serverInstalled) {
    blockMessage = tl('notes.auto.t0245', { v0: (title) });
  } else if (active !== 'active') {
    blockMessage = tl('notes.auto.t0246', { v0: (title) });
  } else if (!clientInstalled) {
    blockMessage = tl('notes.auto.t0247', { v0: (title) });
  }

  return {
    engine,
    title,
    clientInstalled,
    serverInstalled,
    unit,
    active: serverInstalled ? active : 'not_installed',
    version,
    executeEnabled,
    isRoot,
    canProvision,
    canInstall,
    blockMessage: canProvision ? undefined : blockMessage,
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
  steps.push(...(client.steps ?? []).map((s) => ({ ...s, name: tl('notes.auto.t0248', { v0: (s.name) }) })));
  notes.push(...client.notes);

  const server = await installSoftware({
    host: input.host,
    id: serverId,
    dataDir: input.dataDir,
    enableUnits: true,
  });
  steps.push(...(server.steps ?? []).map((s) => ({ ...s, name: tl('notes.auto.t0249', { v0: (s.name) }) })));
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
    notes: notes.length ? notes : ok ? [tl('notes.auto.t0250', { v0: (status.title) })] : [tl('notes.auto.t0251', { v0: (status.title) })],
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
  const r = await input.host.runCommand(['systemctl', 'enable', '--now', unit], {
    timeoutMs: 120_000,
  });
  const status = await probeDbEngine(input.host, input.engine);
  const ok = status.active === 'active';
  return {
    ok,
    notes: ok
      ? [tl('notes.auto.t0252', { v0: (status.title) })]
      : [tl('notes.auto.t0253', { v0: (r.stderr || status.active) })],
    status,
  };
}
