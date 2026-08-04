/**
 * Fail-closed MySQL ↔ MariaDB switch: dump → stop/purge → install → import → verify.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tl } from '@ysk/shared';
import type { HostExecutor } from '../../host/executor.js';
import { panelBlockMessage } from '../system-apply.js';
import { installSoftware } from '../software-install.js';
import { HostSoftwareProbe, resolveBin, waitUnitActive } from '../software-probe/index.js';
import { exportUserGrants } from './grants.js';
import {
  listUserDatabases,
  previewSqlEngineSwitch,
  sourceServerId,
  sourceUnit,
  targetServerId,
  targetUnit,
} from './preview.js';
import {
  SQL_SWITCH_CONFIRM_PHRASE,
  type SqlSwitchResult,
  type SqlSwitchStep,
  type SqlSwitchTarget,
  type SqlSwitchWarningKey,
} from './types.js';

/** In-process only — installSoftware refuses exclusive without this flag set by switch. */
export const EXCLUSIVE_SWITCH_AUTH = { __yskSqlEngineSwitch: true as const };

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function flavorLabel(f: string): string {
  if (f === 'mysql') return 'MySQL';
  if (f === 'mariadb') return 'MariaDB';
  return f;
}

/** Operator notes from warning keys (request locale via tl). */
function notesFromWarningKeys(
  keys: SqlSwitchWarningKey[] | undefined,
  from: string,
  to: string,
  dbCount: number,
): string[] {
  if (!keys?.length) return [];
  return keys.slice(0, 6).map((k) =>
    tl(`sqlEngineSwitch.warn.${k}`, { from: flavorLabel(from), to: flavorLabel(to), count: dbCount }),
  );
}

async function dumpOneDatabase(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
  dbName: string,
  outPath: string,
  rootPassword?: string,
): Promise<{ ok: boolean; detail: string }> {
  const { sqlPasswordEnvPrefix } = await import('./sql-auth.js');
  const env = sqlPasswordEnvPrefix(rootPassword);
  const dumpPref = flavor === 'mariadb' ? 'mariadb-dump' : 'mysqldump';
  const bin =
    (await resolveBin(host, dumpPref)) ||
    (await resolveBin(host, 'mysqldump')) ||
    'mysqldump';
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `${env}${JSON.stringify(bin)} --single-transaction --routines --triggers --events --databases ${JSON.stringify(dbName)} > ${JSON.stringify(outPath)} 2>/tmp/ysk-sqldump.err; ec=$?; if [ $ec -ne 0 ]; then cat /tmp/ysk-sqldump.err; fi; exit $ec`,
    ],
    { timeoutMs: 600_000 },
  );
  const size = existsSync(outPath) ? readFileSync(outPath).length : 0;
  if (r.exitCode !== 0 || size < 1) {
    return {
      ok: false,
      detail: (r.stderr || r.stdout || `empty dump for ${dbName}`).slice(0, 500),
    };
  }
  return { ok: true, detail: `${dbName} → ${outPath} (${size} bytes)` };
}

export async function switchSqlEngine(input: {
  host: HostExecutor;
  dataDir: string;
  target: SqlSwitchTarget;
  confirmPhrase: string;
  acknowledgeExclusive: boolean;
  migrateData?: boolean;
  /** Optional root password (or set YSK_SQL_ROOT_PASSWORD) when socket auth is unavailable */
  rootPassword?: string;
}): Promise<SqlSwitchResult> {
  const steps: SqlSwitchStep[] = [];
  const notes: string[] = [];
  const target = input.target;

  if (target !== 'mysql' && target !== 'mariadb') {
    return {
      ok: false,
      executed: false,
      code: 'needs_confirm',
      notes: [tl('sqlEngineSwitch.note.invalidTarget')],
      steps: [{ name: tl('sqlEngineSwitch.step.preflight'), status: 'failed', detail: 'invalid target' }],
    };
  }

  if (input.confirmPhrase !== SQL_SWITCH_CONFIRM_PHRASE) {
    return {
      ok: false,
      executed: false,
      code: 'needs_confirm',
      notes: [tl('sqlEngineSwitch.note.badConfirmPhrase')],
      steps: [{ name: tl('sqlEngineSwitch.step.confirm'), status: 'failed', detail: 'bad confirmPhrase' }],
      target,
    };
  }
  if (input.acknowledgeExclusive !== true) {
    return {
      ok: false,
      executed: false,
      code: 'needs_confirm',
      notes: [tl('sqlEngineSwitch.note.needAck')],
      steps: [{ name: tl('sqlEngineSwitch.step.confirm'), status: 'failed', detail: 'acknowledgeExclusive required' }],
      target,
    };
  }

  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    const reason = !input.host.executeEnabled() ? 'no_execute' : 'no_root';
    const blockMessage = panelBlockMessage(reason);
    return {
      ok: false,
      executed: false,
      blocked: true,
      blockMessage,
      notes: [blockMessage],
      steps: [{ name: 'preflight', status: 'blocked', detail: blockMessage }],
      target,
    };
  }

  const { resolveSqlRootPassword, sqlPasswordEnvPrefix } = await import('./sql-auth.js');
  const rootPassword = resolveSqlRootPassword(input.rootPassword);

  const preview = await previewSqlEngineSwitch({
    host: input.host,
    target,
    dataDir: input.dataDir,
    rootPassword,
  });
  if (!preview.needsSwitch) {
    return {
      ok: false,
      executed: false,
      notes: [tl('sqlEngineSwitch.note.switchNotNeeded')],
      steps: [{ name: tl('sqlEngineSwitch.step.preflight'), status: 'failed', detail: preview.blockReason }],
      currentFlavor: preview.currentFlavor,
      target,
    };
  }
  if (!preview.canProceed) {
    return {
      ok: false,
      executed: false,
      blocked: true,
      blockMessage: preview.blockReason,
      notes: [preview.blockReason ?? tl('sqlEngineSwitch.note.switchNotNeeded')],
      steps: [{ name: tl('sqlEngineSwitch.step.preflight'), status: 'blocked', detail: preview.blockReason }],
      currentFlavor: preview.currentFlavor,
      target,
    };
  }

  const sourceFlavor = preview.currentFlavor as 'mysql' | 'mariadb';
  const migrateData = input.migrateData !== false;
  if (!migrateData && preview.databases.length > 0) {
    return {
      ok: false,
      executed: false,
      code: 'needs_confirm',
      notes: [tl('sqlEngineSwitch.note.migrateDataRequired')],
      steps: [{ name: tl('sqlEngineSwitch.step.confirm'), status: 'failed', detail: 'migrateData required' }],
      currentFlavor: sourceFlavor,
      target,
    };
  }

  const runStamp = stamp();
  const dumpPath = join(input.dataDir, 'sql-engine-switch', runStamp);
  mkdirSync(dumpPath, { recursive: true });
  writeFileSync(
    join(dumpPath, 'meta.json'),
    JSON.stringify(
      {
        sourceFlavor,
        target,
        at: new Date().toISOString(),
        databases: preview.databases,
      },
      null,
      2,
    ),
  );

  // —— Phase dump ——
  notes.push(
    ...notesFromWarningKeys(
      preview.warningKeys,
      sourceFlavor,
      target,
      preview.databases.length,
    ),
  );
  const dbs =
    preview.databases.length > 0
      ? preview.databases
      : await listUserDatabases(input.host, sourceFlavor, rootPassword);

  if (migrateData) {
    for (const db of dbs) {
      const out = join(dumpPath, `${db.name}.sql`);
      const d = await dumpOneDatabase(input.host, sourceFlavor, db.name, out, rootPassword);
      steps.push({
        name: tl('sqlEngineSwitch.step.dump', { db: db.name }),
        status: d.ok ? 'ok' : 'failed',
        detail: d.detail,
      });
      if (!d.ok) {
        notes.push(
          tl('sqlEngineSwitch.note.dumpFailed', {
            source: flavorLabel(sourceFlavor),
            detail: d.detail,
          }),
        );
        return {
          ok: false,
          executed: true,
          code: 'failed_safe',
          notes,
          steps,
          dumpPath,
          currentFlavor: sourceFlavor,
          target,
        };
      }
    }
    const grants = await exportUserGrants(input.host, sourceFlavor, rootPassword);
    writeFileSync(join(dumpPath, 'grants.sql'), grants.sql);
    steps.push({
      name: tl('sqlEngineSwitch.step.exportGrants'),
      status: 'ok',
      detail: grants.notes.join('; '),
    });
    writeFileSync(join(dumpPath, 'databases.json'), JSON.stringify(dbs, null, 2));
  } else {
    steps.push({
      name: tl('sqlEngineSwitch.step.dump', { db: '—' }),
      status: 'skipped',
      detail: 'no user DBs / migrateData false',
    });
  }

  // —— stop + backup datadir + purge ——
  const sUnit = sourceUnit(sourceFlavor);
  const sPkg = sourceServerId(sourceFlavor);
  await input.host.runCommand(['systemctl', 'stop', sUnit], { timeoutMs: 60_000 });
  steps.push({ name: tl('sqlEngineSwitch.step.stop', { unit: sUnit }), status: 'ok' });

  const datadirBackup = `/var/lib/mysql.ysk-pre-switch-${runStamp}`;
  const mv = await input.host.runCommand(
    [
      'bash',
      '-c',
      `if [ -d /var/lib/mysql ]; then mv /var/lib/mysql ${JSON.stringify(datadirBackup)}; mkdir -p /var/lib/mysql; fi`,
    ],
    { timeoutMs: 120_000 },
  );
  steps.push({
    name: tl('sqlEngineSwitch.step.backupDatadir'),
    status: mv.exitCode === 0 ? 'ok' : 'failed',
    detail: mv.exitCode === 0 ? datadirBackup : mv.stderr || mv.stdout,
  });
  if (mv.exitCode !== 0) {
    notes.push(tl('sqlEngineSwitch.note.datadirBackupFailed'));
    await input.host.runCommand(['systemctl', 'start', sUnit], { timeoutMs: 60_000 });
    return {
      ok: false,
      executed: true,
      code: 'failed_safe',
      notes,
      steps,
      dumpPath,
      currentFlavor: sourceFlavor,
      target,
    };
  }

  const purgePkgs =
    sourceFlavor === 'mariadb'
      ? 'mariadb-server mariadb-server-core-* mariadb-client mariadb-client-core-*'
      : 'mysql-server mysql-server-core-* mysql-client mysql-client-core-*';
  // Keep generic client if possible; purge server primarily
  const purge = await input.host.runCommand(
    [
      'bash',
      '-c',
      `export DEBIAN_FRONTEND=noninteractive; apt-get remove -y ${
        sourceFlavor === 'mariadb' ? 'mariadb-server' : 'mysql-server'
      } 2>&1; apt-get purge -y ${
        sourceFlavor === 'mariadb' ? 'mariadb-server' : 'mysql-server'
      } 2>&1; apt-get -y -f install 2>&1; true`,
    ],
    { timeoutMs: 600_000 },
  );
  steps.push({
    name: tl('sqlEngineSwitch.step.purge', { pkg: sPkg }),
    status: purge.exitCode === 0 ? 'ok' : 'failed',
    detail: (purge.stdout || purge.stderr).slice(-400),
  });
  // Continue even if purge non-zero — install target may still work after remove
  void purgePkgs;

  // —— install target (authorized exclusive path) ——
  const tId = targetServerId(target);
  const tUnit = targetUnit(target);
  const inst = await installSoftware({
    host: input.host,
    id: tId,
    dataDir: input.dataDir,
    enableUnits: true,
    exclusiveSwitchAuth: EXCLUSIVE_SWITCH_AUTH,
  });
  steps.push(...(inst.steps ?? []).map((s) => ({ name: s.name, status: s.status, detail: s.detail })));
  notes.push(...inst.notes);

  const wait = await waitUnitActive(input.host, tUnit, { timeoutMs: 120_000 });
  steps.push({
    name: tl('sqlEngineSwitch.step.wait', { unit: tUnit }),
    status: wait.ok ? 'ok' : 'failed',
    detail: wait.active,
  });
  if (!wait.ok) {
    notes.push(
      tl('sqlEngineSwitch.note.waitFailed', { dumpPath, datadir: datadirBackup }),
    );
    return {
      ok: false,
      executed: true,
      code: 'failed_need_manual',
      notes,
      steps,
      dumpPath,
      oldDatadirBackup: datadirBackup,
      currentFlavor: sourceFlavor,
      target,
    };
  }

  // —— import ——
  const client = target === 'mariadb' ? 'mariadb' : 'mysql';
  const env = sqlPasswordEnvPrefix(rootPassword);
  let imported = 0;
  let importHardFail = false;
  if (migrateData && dbs.length) {
    for (const db of dbs) {
      const sqlFile = join(dumpPath, `${db.name}.sql`);
      if (!existsSync(sqlFile)) {
        steps.push({
          name: tl('sqlEngineSwitch.step.importDb', { db: db.name }),
          status: 'failed',
          detail: 'missing dump file',
        });
        importHardFail = true;
        continue;
      }
      const r = await input.host.runCommand(
        [
          'bash',
          '-c',
          `${env}${client} < ${JSON.stringify(sqlFile)} 2>&1 || ${env}mysql < ${JSON.stringify(sqlFile)} 2>&1`,
        ],
        { timeoutMs: 600_000 },
      );
      const ok = r.exitCode === 0;
      if (ok) imported++;
      else importHardFail = true;
      steps.push({
        name: tl('sqlEngineSwitch.step.importDb', { db: db.name }),
        status: ok ? 'ok' : 'failed',
        detail: ok ? undefined : (r.stderr || r.stdout).slice(0, 400),
      });
    }
    const grantsPath = join(dumpPath, 'grants.sql');
    if (existsSync(grantsPath)) {
      const g = await input.host.runCommand(
        [
          'bash',
          '-c',
          `${env}${client} < ${JSON.stringify(grantsPath)} 2>&1 || ${env}mysql < ${JSON.stringify(grantsPath)} 2>&1 || true`,
        ],
        { timeoutMs: 120_000 },
      );
      steps.push({
        name: tl('sqlEngineSwitch.step.importGrants'),
        status: g.exitCode === 0 ? 'ok' : 'skipped',
        detail: (g.stderr || g.stdout).slice(0, 200),
      });
    }
  }

  // —— verify ——
  const after = await listUserDatabases(input.host, target, rootPassword);
  const afterNames = new Set(after.map((d) => d.name));
  const missing = dbs.map((d) => d.name).filter((n) => !afterNames.has(n));
  const probe = new HostSoftwareProbe(input.host);
  const flavor = await probe.detectSqlFlavor();
  const verifyOk = missing.length === 0 && flavor === target && !importHardFail;

  steps.push({
    name: tl('sqlEngineSwitch.step.verify'),
    status: verifyOk ? 'ok' : 'failed',
    detail: verifyOk
      ? `flavor=${flavor}; dbs=${after.map((d) => d.name).join(',')}`
      : `missing dbs: ${missing.join(', ')}; flavor=${flavor}; importHardFail=${importHardFail}`,
  });

  if (!verifyOk) {
    notes.push(
      tl('sqlEngineSwitch.note.incomplete', { dumpPath, datadir: datadirBackup }),
    );
    return {
      ok: false,
      executed: true,
      code: 'failed_need_manual',
      notes,
      steps,
      dumpPath,
      oldDatadirBackup: datadirBackup,
      currentFlavor: sourceFlavor,
      target,
    };
  }

  notes.push(
    tl('sqlEngineSwitch.note.switched', {
      from: flavorLabel(sourceFlavor),
      to: flavorLabel(target),
      imported,
      total: dbs.length,
    }),
    tl('sqlEngineSwitch.note.dumpPath', { path: dumpPath }),
    tl('sqlEngineSwitch.note.datadirBackup', { path: datadirBackup }),
  );

  return {
    ok: true,
    executed: true,
    notes,
    steps,
    dumpPath,
    oldDatadirBackup: datadirBackup,
    currentFlavor: sourceFlavor,
    target,
  };
}

/** Files present under a dump dir (tests/helpers). */
export function listDumpSqlFiles(dumpPath: string): string[] {
  if (!existsSync(dumpPath)) return [];
  return readdirSync(dumpPath).filter((n) => n.endsWith('.sql'));
}
