import { tl } from 'ysk-server-shared';
/**
 * Probe + one-click install for catalog software (panel only).
 */

import type { HostExecutor } from '../host/executor.js';
import {
  getSoftware,
  listSoftwareForFeature,
  resolveSoftwareTitle,
  type SoftwareId,
  type SoftwareSpec } from './software-catalog.js';
import { panelBlockMessage, type BlockReason } from './system-apply.js';
import { planOrInstallRuntime } from './runtime-probe.js';
import {
  HostSoftwareProbe,
  resolveBin,
  unitIsActive,
  waitUnitActive,
} from './software-probe/index.js';

export type SoftwareStatus = {
  id: SoftwareId | string;
  title: string;
  installed: boolean;
  active?: string;
  bins: string[];
  missingBins: string[];
  features: string[];
};

export type SoftwareInstallStep = {
  name: string;
  status: 'ok' | 'skipped' | 'failed' | 'blocked';
  detail?: string;
};

export type SoftwareInstallResult = {
  ok: boolean;
  executed: boolean;
  blocked?: boolean;
  blockReason?: BlockReason;
  blockMessage?: string;
  id: string;
  title: string;
  installed: boolean;
  notes: string[];
  steps: SoftwareInstallStep[];
  status: SoftwareStatus;
  /** UI must open SQL engine switch dialog instead of bare apt */
  code?: 'needs_exclusive_switch' | string;
  switchTarget?: 'mysql' | 'mariadb';
  blockedByExclusive?: string;
};

/** In-process auth from sql-engine-switch only (not HTTP-forgable alone). */
export type ExclusiveSwitchAuth = { __yskSqlEngineSwitch: true };

let lastAptUpdateMs = 0;
const APT_UPDATE_MS = 5 * 60_000;

export async function probeSoftware(
  host: HostExecutor,
  spec: SoftwareSpec,
): Promise<SoftwareStatus> {
  // Single standard: HostSoftwareProbe.presence (exclusive flavor for mysql/mariadb)
  const probe = new HostSoftwareProbe(host);
  const p = await probe.presence(spec.id);
  let active: string | undefined;
  if (spec.units?.[0] && p.installed) {
    active = await unitIsActive(host, spec.units[0]);
  }

  return {
    id: spec.id,
    title: resolveSoftwareTitle(spec),
    installed: p.installed,
    active,
    bins: spec.bins,
    missingBins: p.missingBins,
    features: spec.features };
}

export async function probeAllSoftware(
  host: HostExecutor,
  feature?: string,
): Promise<SoftwareStatus[]> {
  const list = listSoftwareForFeature(feature ?? 'all');
  const out: SoftwareStatus[] = [];
  for (const spec of list) {
    out.push(await probeSoftware(host, spec));
  }
  return out;
}

export async function installSoftware(input: {
  host: HostExecutor;
  id: string;
  dataDir?: string;
  /** enable units after apt (default true) */
  enableUnits?: boolean;
  /**
   * Only sql-engine-switch may set this after user confirmed exclusive switch.
   * Without it, installing mysql-server while MariaDB is present (or reverse) is refused.
   */
  exclusiveSwitchAuth?: ExclusiveSwitchAuth;
  /** Live log sink for SSE UIs */
  onLog?: (stream: 'stdout' | 'stderr' | 'status', line: string) => void;
}): Promise<SoftwareInstallResult> {
  const log = (
    stream: 'stdout' | 'stderr' | 'status',
    line: string,
  ) => {
    const t = String(line ?? '').trim();
    if (t) input.onLog?.(stream, t);
  };
  const spec = getSoftware(input.id);
  if (!spec) {
    return {
      ok: false,
      executed: false,
      id: input.id,
      title: input.id,
      installed: false,
      notes: [tl('notes.auto.n0967')],
      steps: [{ name: tl('notes.auto.n1607'), status: 'failed', detail: tl('notes.auto.n0968') }],
      status: {
        id: input.id,
        title: input.id,
        installed: false,
        bins: [],
        missingBins: [],
        features: [] } };
  }

  const steps: SoftwareInstallStep[] = [];
  const notes: string[] = [];

  // Exclusive gate: MySQL XOR MariaDB — bare one-click must not apt-install over the other
  if (
    (spec.id === 'mysql-server' || spec.id === 'mariadb-server') &&
    input.exclusiveSwitchAuth?.__yskSqlEngineSwitch !== true
  ) {
    const probe = new HostSoftwareProbe(input.host);
    const presence = await probe.presence(spec.id);
    if (presence.blockedByExclusive) {
      const switchTarget = spec.id === 'mysql-server' ? 'mysql' : 'mariadb';
      const other =
        presence.blockedByExclusive === 'mariadb-server' ? 'MariaDB' : 'MySQL';
      const msg = tl('sqlEngineSwitch.note.needsSwitch', { other });
      return {
        ok: false,
        executed: false,
        id: spec.id,
        title: resolveSoftwareTitle(spec),
        installed: false,
        notes: [msg],
        steps: [{ name: 'exclusive-gate', status: 'blocked', detail: msg }],
        status: await probeSoftware(input.host, spec),
        code: 'needs_exclusive_switch',
        switchTarget,
        blockedByExclusive: presence.blockedByExclusive,
        blockMessage: msg,
      };
    }
  }

  const before = await probeSoftware(input.host, spec);
  if (before.installed) {
    notes.push(tl('notes.auto.t0149', { v0: resolveSoftwareTitle(spec) }));
    let unitFailed = false;
    if (spec.units?.length && input.enableUnits !== false) {
      // If unit is failed (e.g. port conflict), free :80 and retry start
      for (const u of spec.units) {
        const cur = await unitIsActive(input.host, u);
        if (cur === 'failed' || cur === 'inactive' || cur === 'activating') {
          await freeHttpPortForSpec(input.host, spec.id, steps, notes);
        }
        await input.host.runCommand(['systemctl', 'enable', '--now', u], {
          timeoutMs: 60_000,
        });
        const waited = await waitUnitActive(input.host, u, {
          timeoutMs: u === 'mysql' || u === 'mariadb' ? 120_000 : 45_000,
        });
        const unitOk = waited.ok;
        steps.push({
          name: tl('notes.software.startUnit', { u }),
          status: unitOk ? 'ok' : 'failed',
          detail: unitOk ? 'ok' : `systemctl is-active → ${waited.active ?? 'unknown'}`,
        });
        if (!unitOk) {
          unitFailed = true;
          notes.push(await unitFailureHint(input.host, u, waited.active ?? 'unknown'));
        }
      }
    }
    const status = await probeSoftware(input.host, spec);
    return {
      ok: !unitFailed,
      executed: false,
      id: spec.id,
      title: resolveSoftwareTitle(spec),
      installed: true,
      notes,
      steps: steps.length
        ? steps
        : [{ name: tl('notes.probe'), status: 'ok', detail: tl('notes.tpl.installed') }],
      status,
    };
  }

  const can = input.host.executeEnabled() && input.host.isRoot();
  if (!can) {
    const blockReason: BlockReason = !input.host.executeEnabled() ? 'no_execute' : 'no_root';
    const blockMessage = panelBlockMessage(blockReason);
    notes.push(blockMessage);
    log('stderr', blockMessage);
    steps.push({ name: tl('notes.auto.n0487'), status: 'blocked', detail: blockMessage });
    return {
      ok: false,
      executed: false,
      blocked: true,
      blockReason,
      blockMessage,
      id: spec.id,
      title: resolveSoftwareTitle(spec),
      installed: false,
      notes,
      steps,
      status: before };
  }

  log('status', `install ${spec.id} (${resolveSoftwareTitle(spec)})`);

  // npm -g installers (PM2, etc.) — requires node/npm already on PATH
  if (spec.installer === 'npm-global') {
    const pkgs = (spec.npmPackages ?? []).filter(Boolean);
    if (!pkgs.length) {
      notes.push(tl('notes.auto.n1041'));
      return {
        ok: false,
        executed: false,
        id: spec.id,
        title: resolveSoftwareTitle(spec),
        installed: false,
        notes,
        steps: [{ name: tl('notes.install'), status: 'failed', detail: tl('notes.tpl.noPackages') }],
        status: before,
      };
    }
    const npmPath = await resolveBin(input.host, 'npm');
    const nodePath = await resolveBin(input.host, 'node');
    if (!npmPath || !nodePath) {
      notes.push(tl('notes.software.needNodeForNpm', { title: resolveSoftwareTitle(spec) }));
      steps.push({
        name: tl('notes.install'),
        status: 'failed',
        detail: tl('notes.software.needNodeForNpm', { title: resolveSoftwareTitle(spec) }),
      });
      return {
        ok: false,
        executed: false,
        id: spec.id,
        title: resolveSoftwareTitle(spec),
        installed: false,
        notes,
        steps,
        status: before,
      };
    }
    const cmd = [
      'bash',
      '-c',
      `npm install -g ${pkgs.map((p) => JSON.stringify(p)).join(' ')} 2>&1`,
    ];
    log('status', `npm install -g ${pkgs.join(' ')}`);
    const r = await input.host.runCommand(cmd, { timeoutMs: 300_000 });
    for (const line of (r.stdout || r.stderr || '').split('\n').slice(-50)) {
      log(r.exitCode === 0 ? 'stdout' : 'stderr', line);
    }
    const status = await probeSoftware(input.host, spec);
    const ok = r.exitCode === 0 && status.installed;
    steps.push({
      name: tl('notes.software.npmGlobal', { pkgs: pkgs.join(', ') }),
      status: r.exitCode === 0 ? 'ok' : 'failed',
      detail: r.exitCode === 0 ? undefined : (r.stderr || r.stdout || '').slice(0, 400),
    });
    notes.push(
      ok
        ? tl('notes.software.installedSpec', { title: resolveSoftwareTitle(spec) })
        : tl('notes.tpl.installIncomplete'),
    );
    if (!ok && (r.stderr || r.stdout)) {
      notes.push((r.stderr || r.stdout || '').trim().slice(0, 300));
    }
    return {
      ok,
      executed: true,
      id: spec.id,
      title: resolveSoftwareTitle(spec),
      installed: status.installed,
      notes,
      steps,
      status,
    };
  }

  // Runtime installers
  if (
    spec.installer === 'runtime-node' ||
    spec.installer === 'runtime-php' ||
    spec.installer === 'runtime-python' ||
    spec.installer === 'runtime-go' ||
    spec.installer === 'runtime-rust' ||
    spec.installer === 'runtime-java' ||
    spec.installer === 'runtime-kotlin' ||
    spec.installer === 'runtime-bun'
  ) {
    if (!input.dataDir) {
      notes.push(tl('notes.auto.n1323'));
      return {
        ok: false,
        executed: false,
        id: spec.id,
        title: resolveSoftwareTitle(spec),
        installed: false,
        notes,
        steps: [{ name: tl('notes.install'), status: 'failed', detail: tl('notes.tpl.missingDataDir') }],
        status: before };
    }
    const kindMap = {
      'runtime-node': 'node',
      'runtime-php': 'php',
      'runtime-python': 'python',
      'runtime-go': 'go',
      'runtime-rust': 'rust',
      'runtime-java': 'java',
      'runtime-kotlin': 'kotlin',
      'runtime-bun': 'bun',
    } as const;
    const kind = kindMap[spec.installer];
    const defaultVer: Record<string, string> = {
      node: '20',
      php: '8.3',
      python: '3.12',
      go: '1.22',
      rust: 'stable',
      java: '21',
      kotlin: '2.1.0',
      bun: 'latest',
    };
    const version = spec.runtimeVersion ?? defaultVer[kind] ?? 'latest';
    log('status', `runtime install ${kind}@${version}`);
    const r = await planOrInstallRuntime({
      host: input.host,
      dataDir: input.dataDir,
      kind,
      version,
      install: true });
    for (const n of r.notes ?? []) log(r.ok ? 'stdout' : 'stderr', n);
    const status = await probeSoftware(input.host, spec);
    return {
      ok: r.ok && status.installed,
      executed: true,
      blocked: r.ok === false && (r.requiresExecute || r.requiresRoot),
      blockMessage:
        r.ok === false && (r.requiresExecute || r.requiresRoot)
          ? panelBlockMessage(r.requiresExecute ? 'no_execute' : 'no_root')
          : undefined,
      id: spec.id,
      title: resolveSoftwareTitle(spec),
      installed: status.installed,
      notes: r.notes.length ? r.notes : status.installed ? [tl('notes.software.installedSpec', { title: resolveSoftwareTitle(spec) })] : [tl('notes.tpl.installIncomplete')],
      steps: (r.notes ?? []).slice(0, 6).map((n) => ({
        name: tl('notes.auto.n0657'),
        status: r.ok ? ('ok' as const) : ('failed' as const),
        detail: n })),
      status };
  }

  // apt path
  const pkgs = spec.aptPackages.filter(Boolean);
  if (!pkgs.length) {
    notes.push(tl('notes.auto.n1041'));
    log('stderr', tl('notes.auto.n1041'));
    return {
      ok: false,
      executed: false,
      id: spec.id,
      title: resolveSoftwareTitle(spec),
      installed: false,
      notes,
      steps: [{ name: tl('notes.install'), status: 'failed', detail: tl('notes.tpl.noPackages') }],
      status: before };
  }

  const now = Date.now();
  if (now - lastAptUpdateMs > APT_UPDATE_MS) {
    log('status', 'apt-get update');
    const up = await input.host.runCommand(
      ['bash', '-c', 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq 2>&1'],
      { timeoutMs: 180_000 },
    );
    for (const line of (up.stdout || up.stderr || '').split('\n').slice(-20)) {
      log(up.exitCode === 0 ? 'stdout' : 'stderr', line);
    }
    steps.push({
      name: tl('notes.apt.updateIndex'),
      status: up.exitCode === 0 ? 'ok' : 'failed',
      detail: up.exitCode === 0 ? undefined : up.stderr });
    if (up.exitCode === 0) lastAptUpdateMs = now;
  } else {
    steps.push({ name: tl('notes.apt.updateIndex'), status: 'skipped', detail: tl('notes.tpl.recentlyUpdated') });
    log('status', 'apt update skipped (recent)');
  }

  // Postfix: seed debconf so postinst creates main.cf (never "No configuration")
  if (spec.id === 'postfix') {
    try {
      const { preseedPostfixDebconf } = await import('./postfix-bootstrap.js');
      const pre = await preseedPostfixDebconf(input.host);
      notes.push(...pre);
      for (const n of pre) log('status', n);
    } catch {
      /* best-effort */
    }
  }

  // Try packages one-by-one groups: first package set as OR — install all listed, ignore individual fails partially
  log('status', `apt-get install -y ${pkgs.join(' ')}`);
  const installCmd = `export DEBIAN_FRONTEND=noninteractive; apt-get install -y ${pkgs.map((p) => JSON.stringify(p)).join(' ')} 2>&1`;
  const inst = await input.host.runCommand(['bash', '-c', installCmd], { timeoutMs: 600_000 });
  for (const line of (inst.stdout || inst.stderr || '').split('\n').slice(-80)) {
    log(inst.exitCode === 0 ? 'stdout' : 'stderr', line);
  }
  // mysql-client OR mariadb-client: if full fail, try each
  let installOk = inst.exitCode === 0;
  if (!installOk && pkgs.length > 1) {
    for (const p of pkgs) {
      log('status', `retry apt install ${p}`);
      const one = await input.host.runCommand(
        ['bash', '-c', `export DEBIAN_FRONTEND=noninteractive; apt-get install -y ${JSON.stringify(p)} 2>&1`],
        { timeoutMs: 300_000 },
      );
      for (const line of (one.stdout || one.stderr || '').split('\n').slice(-30)) {
        log(one.exitCode === 0 ? 'stdout' : 'stderr', line);
      }
      if (one.exitCode === 0) {
        installOk = true;
        steps.push({ name: tl('notes.software.installPkg', { p }), status: 'ok' });
        break;
      }
      steps.push({ name: tl('notes.software.installPkg', { p }), status: 'failed', detail: one.stderr });
    }
  } else {
    steps.push({
      name: tl('notes.auto.t0150', { v0: (pkgs.join(', ')) }),
      status: installOk ? 'ok' : 'failed',
      detail: installOk ? undefined : inst.stderr });
  }

  if (installOk && spec.units?.length && input.enableUnits !== false) {
    await freeHttpPortForSpec(input.host, spec.id, steps, notes);
    // Postfix: package can install without main.cf → unit ConditionPathExists skip
    if (spec.id === 'postfix') {
      try {
        const { ensurePostfixMainCf, ensurePostfixSetgidGroup } = await import(
          './postfix-bootstrap.js'
        );
        const heal = await ensurePostfixMainCf(input.host);
        notes.push(...heal.notes);
        steps.push({
          name: 'postfix main.cf',
          status: heal.ok ? 'ok' : 'failed',
          detail: heal.created ? 'created from template' : heal.ok ? 'already present' : heal.notes.join('; '),
        });
        const gid = await ensurePostfixSetgidGroup(input.host);
        notes.push(...gid.notes);
        steps.push({
          name: 'postfix setgid_group',
          status: gid.ok ? 'ok' : 'failed',
          detail: gid.notes.join('; '),
        });
      } catch (e) {
        notes.push(`postfix main.cf ensure failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const u of spec.units) {
      log('status', `systemctl enable --now ${u}`);
      const en = await input.host.runCommand(['systemctl', 'enable', '--now', u], {
        timeoutMs: 60_000 });
      let waited = await waitUnitActive(input.host, u, {
        timeoutMs: u === 'mysql' || u === 'mariadb' ? 120_000 : 60_000,
      });
      log(
        waited.ok ? 'stdout' : 'stderr',
        waited.ok ? `${u} active` : `${u} not active: ${waited.active || en.stderr}`,
      );
      // MySQL/MariaDB: Debian FROZEN after engine switch — package OK but daemon blocked
      if (!waited.ok && (u === 'mysql' || u === 'mariadb' || u === 'mysqld')) {
        try {
          const { recoverMysqlAfterEngineSwitch, readMysqlFrozen } = await import(
            './sql-engine-switch/mysql-frozen.js'
          );
          const frozen = await readMysqlFrozen(input.host);
          if (frozen.frozen) {
            notes.push(await unitFailureHint(input.host, u, waited.active ?? 'failed'));
            const flavor = u === 'mariadb' ? 'mariadb' : 'mysql';
            const rec = await recoverMysqlAfterEngineSwitch(input.host, flavor);
            notes.push(...rec.notes);
            for (const s of rec.steps) {
              steps.push({
                name: s.name,
                status: (s.status === 'ok' || s.status === 'skipped' || s.status === 'failed'
                  ? s.status
                  : 'failed') as SoftwareInstallStep['status'],
                detail: s.detail,
              });
            }
            waited = await waitUnitActive(input.host, u, { timeoutMs: 120_000 });
          }
        } catch {
          /* recovery best-effort */
        }
      }
      const unitOk = waited.ok;
      steps.push({
        name: tl('notes.software.startUnit', { u }),
        status: unitOk ? 'ok' : 'failed',
        detail: unitOk
          ? tl('notes.auto.n0744')
          : en.stderr || `systemctl is-active → ${waited.active}`,
      });
      if (!unitOk) {
        notes.push(await unitFailureHint(input.host, u, waited.active ?? 'unknown'));
      }
    }
  }

  const status = await probeSoftware(input.host, spec);
  let unitsOk = true;
  if (installOk && spec.units?.length && input.enableUnits !== false) {
    for (const u of spec.units) {
      const a = await unitIsActive(input.host, u);
      if (a !== 'active') unitsOk = false;
    }
  }
  const ok = status.installed && unitsOk;
  notes.push(
    ok
      ? tl('notes.software.installedSpec', { title: resolveSoftwareTitle(spec) })
      : tl('notes.auto.t0151', { v0: resolveSoftwareTitle(spec) }),
  );
  return {
    ok,
    executed: true,
    id: spec.id,
    title: resolveSoftwareTitle(spec),
    installed: status.installed,
    notes,
    steps,
    status };
}

/**
 * Topology: Nginx public :80/:443 → proxy → Apache PHP backend (127.0.0.1:8080) → PHP-FPM.
 * When starting Nginx/Apache, rebind Apache off public ports (do not stop Apache).
 */
async function freeHttpPortForSpec(
  host: HostExecutor,
  id: string,
  steps: SoftwareInstallStep[],
  notes: string[],
): Promise<void> {
  if (id !== 'nginx' && id !== 'apache2') return;
  if (!host.pathExists('/etc/apache2') && id === 'nginx') return;

  const bind = process.env.YSK_APACHE_BACKEND_BIND || '127.0.0.1';
  const port = process.env.YSK_APACHE_BACKEND_PORT || '8080';
  notes.push(
    id === 'nginx'
      ? `Rebinding Apache to ${bind}:${port} so Nginx owns :80/:443 and proxies PHP to Apache→FPM`
      : `Configuring Apache as Nginx PHP backend on ${bind}:${port}`,
  );

  const script = `
set -e
BIND=${JSON.stringify(bind)}
PORT=${JSON.stringify(port)}
if [ ! -d /etc/apache2 ]; then exit 0; fi
cp -a /etc/apache2/ports.conf /etc/apache2/ports.conf.ysk-bak 2>/dev/null || true
cat > /etc/apache2/ports.conf <<EOF
# Managed by YSK — Apache PHP backend; Nginx owns public :80/:443 and reverse-proxies here
Listen \${BIND}:\${PORT}
EOF
# Disable stock public sites; rewrite leftover *:80 / [::]:80 VirtualHosts in available/
if [ -x /usr/sbin/a2dissite ]; then
  a2dissite 000-default 2>/dev/null || true
  a2dissite default-ssl 2>/dev/null || true
fi
if [ -d /etc/apache2/sites-available ]; then
  for f in /etc/apache2/sites-available/*.conf; do
    [ -f "\$f" ] || continue
    case "\$f" in *ysk-*) continue ;; esac
    sed -i \\
      -e "s/<VirtualHost \\*:80>/<VirtualHost \${BIND}:\${PORT}>/g" \\
      -e "s/<VirtualHost \\*:443>/<VirtualHost \${BIND}:\${PORT}>/g" \\
      -e "s/<VirtualHost \\[::\\]:80>/<VirtualHost \${BIND}:\${PORT}>/g" \\
      "\$f" 2>/dev/null || true
  done
fi
a2enmod proxy 2>/dev/null || true
a2enmod proxy_fcgi 2>/dev/null || true
a2enmod setenvif 2>/dev/null || true
a2enmod rewrite 2>/dev/null || true
if [ -x /usr/sbin/apache2ctl ]; then /usr/sbin/apache2ctl configtest; fi
systemctl restart apache2 2>/dev/null || systemctl start apache2 2>/dev/null || true
`.trim();

  const r = await host.runCommand(['bash', '-c', script], { timeoutMs: 60_000 });
  steps.push({
    name: `apache backend rebind (${bind}:${port})`,
    status: r.exitCode === 0 ? 'ok' : 'failed',
    detail: r.exitCode === 0 ? `Listen ${bind}:${port}` : (r.stderr || r.stdout).slice(0, 400),
  });
}

async function unitFailureHint(host: HostExecutor, unit: string, active: string): Promise<string> {
  if (unit === 'nginx' && (active === 'failed' || active === 'inactive')) {
    const apache = await unitIsActive(host, 'apache2');
    if (apache === 'active') {
      return tl('sqlEngineSwitch.note.nginxPortConflict');
    }
    const t = await host.runCommand(['nginx', '-t'], { timeoutMs: 10_000 });
    if (t.exitCode !== 0) {
      return tl('sqlEngineSwitch.note.nginxConfigFailed', {
        detail: (t.stderr || t.stdout).trim().slice(0, 400),
      });
    }
  }
  if (unit === 'mysql' || unit === 'mysqld' || unit === 'mariadb') {
    try {
      const { frozenUnitFailureHint } = await import('./sql-engine-switch/mysql-frozen.js');
      const frozen = await frozenUnitFailureHint(host, unit);
      if (frozen) return frozen;
    } catch {
      /* ignore */
    }
  }
  return tl('sqlEngineSwitch.note.unitNotActive', { unit, active });
}

export async function installSoftwareBatch(input: {
  host: HostExecutor;
  ids: string[];
  dataDir?: string;
  onLog?: (stream: 'stdout' | 'stderr' | 'status', line: string) => void;
}): Promise<{
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  results: SoftwareInstallResult[];
  notes: string[];
}> {
  const results: SoftwareInstallResult[] = [];
  for (const id of input.ids) {
    input.onLog?.('status', `— component ${id}`);
    results.push(
      await installSoftware({
        host: input.host,
        id,
        dataDir: input.dataDir,
        enableUnits: true,
        onLog: input.onLog,
      }),
    );
  }
  const ok = results.every((r) => r.ok);
  const blocked = results.some((r) => r.blocked);
  const blockMessage =
    results.find((r) => r.blockMessage)?.blockMessage ??
    (blocked ? tl('ops.blocked.needExecute') : undefined);
  return {
    ok,
    blocked,
    blockMessage,
    results,
    notes: results.flatMap((r) => r.notes) };
}

export async function installForFeature(input: {
  host: HostExecutor;
  feature: string;
  dataDir?: string;
  /** only missing (default true) */
  onlyMissing?: boolean;
  onLog?: (stream: 'stdout' | 'stderr' | 'status', line: string) => void;
}): Promise<{
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  results: SoftwareInstallResult[];
  missingBefore: SoftwareStatus[];
  notes: string[];
  code?: string;
  switchTarget?: 'mysql' | 'mariadb';
  blockedByExclusive?: string;
}> {
  input.onLog?.('status', `probe feature=${input.feature}`);
  const probed = await probeAllSoftware(input.host, input.feature);
  const missing = probed.filter((p) => !p.installed);
  const ids =
    input.onlyMissing === false ? probed.map((p) => p.id) : missing.map((p) => p.id);
  if (!ids.length) {
    input.onLog?.('status', 'nothing missing');
    return {
      ok: true,
      results: [],
      missingBefore: [],
      notes: [tl('notes.auto.n0841')] };
  }
  input.onLog?.('status', `install ids=${ids.join(',')}`);
  const batch = await installSoftwareBatch({
    host: input.host,
    ids,
    dataDir: input.dataDir,
    onLog: input.onLog,
  });
  const switchHit = batch.results.find((r) => r.code === 'needs_exclusive_switch');
  return {
    ok: batch.ok,
    blocked: batch.blocked,
    blockMessage: batch.blockMessage ?? switchHit?.blockMessage,
    results: batch.results,
    missingBefore: missing,
    notes: batch.notes,
    code: switchHit?.code,
    switchTarget: switchHit?.switchTarget,
    blockedByExclusive: switchHit?.blockedByExclusive,
  };
}
