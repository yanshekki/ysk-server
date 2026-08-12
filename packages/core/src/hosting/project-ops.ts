/**
 * Project operations: real Node process deploy (pidfile + listen + HTTP health)
 * and Nginx publish with correct upstream port.
 */

import { type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  openSync,
  closeSync,
  readdirSync,
  statSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, type OpsResultDto, type ApplyStatus, tl} from '@ysk-server/shared';
import type { HostExecutor } from '../host/executor.js';
import { checkHttp, findFreePort, isPortListening, waitHttpOk } from '../host/health.js';
import type { ProjectRepository, ProjectRow } from '../repositories/project-repo.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import { applyNodeHosting } from './node-apply.js';
import {
  buildServerNameList,
  renderNginxPhpFpm,
  renderNginxProxy,
  renderNginxStatic,
  renderNginxSuspended } from './nginx-ssl.js';
import { syncNginxConfigs, writeManagedNginxConf } from './nginx-sync.js';
import {
  apacheBackendUpstream,
  defaultProcessCommands,
  defaultRuntimeVersion,
  detectBunEntry,
  detectJavaEntry,
  isProcessRuntime,
  renderProcessUnit,
  selectNodeRuntime,
  selectPhpRuntime,
} from './runtime.js';
import { gitSync } from './git-deploy.js';
import { backupProject } from './backup-cron.js';
import { applyPhpHosting } from './system-apply.js';
import { resolveBestCertPaths } from './ssl-certs.js';
import { applyPhpFpmPool } from './php-fpm.js';
import {
  loadPhpIniSettings,
  loadProjectPhpIni,
  mergePhpIni,
  renderPhpAdminValueLines } from './php-ini.js';
import { loadRuntimeTuning, tuningToEnv, type TuningKind } from './runtime-tuning.js';
import { assertQuotaMb, assertWithinQuota, checkProjectQuota } from './quota.js';
import { applyPm2Start, applyPm2Stop, writePm2Ecosystem } from './pm2-apply.js';
import { loadRealIpConfig, type RealIpProviderId } from './real-ip/index.js';
import { applyProjectWebGroupAccess } from './project-web-group.js';
import {
  assertOsIsolationForDeploy,
  canRunAsProjectUser,
  chownProjectHome,
  runAsProjectUser,
  shellQuote,
  spawnAsProjectUser } from './project-user-run.js';
import {
  applyOsUserLimits,
  chownHomeNow,
  probeOsUser,
  type ApplyOsLimitsResult,
  type OsUserLive } from './project-os-user.js';

export type OpsProcessStatus = 'stopped' | 'starting' | 'running' | 'unhealthy' | 'failed';

export type DeployMode = 'systemd' | 'pm2' | 'pidfile' | 'none';

/**
 * Coerce a doc_root string to a safe relative path under project home.
 * Strips leading slashes (legacy "absolute-looking" values), drops `..`.
 */
export function coerceProjectDocRootRel(raw: string | null | undefined): string {
  let s = String(raw ?? 'app/public').trim().replace(/\\/g, '/');
  if (!s) return 'app/public';
  // Drive letters / Windows — treat as invalid → default
  if (/^[A-Za-z]:\//.test(s)) return 'app/public';
  s = s.replace(/^\/+/, '');
  const parts = s.split('/').filter((p) => p && p !== '.' && p !== '..' && !p.includes('\0'));
  const out = parts.join('/');
  return out.slice(0, 200) || 'app/public';
}

/**
 * Normalize project document root for API save (relative to home only).
 * Rejects `..` and empty; leading slash is stripped (same as home-relative intent).
 */
export function normalizeProjectDocRoot(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('..') || trimmed.includes('\0')) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.project.docRootInvalid'), {
      httpStatus: 400,
      details: { docRoot: raw },
    });
  }
  if (/^[A-Za-z]:\//.test(trimmed.replace(/\\/g, '/'))) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.project.docRootMustBeRelative'), {
      httpStatus: 400,
      details: { docRoot: raw },
    });
  }
  const rel = coerceProjectDocRootRel(trimmed);
  return rel || undefined;
}

/** Resolve document root: relative doc_root under home, default app/public */
export function resolveProjectDocRoot(row: ProjectRow): string {
  const rel = coerceProjectDocRootRel(row.doc_root ?? 'app/public');
  return join(row.home_dir, rel);
}

/** Relative doc_root for nginx publish (static/php). */
export function resolveProjectDocRootRel(row: ProjectRow): string {
  return coerceProjectDocRootRel(row.doc_root ?? 'app/public');
}

/**
 * Pick process port: explicit opts → preferred_port → existing → free range.
 * Preferred port busy by another process → validation error (honest).
 */
export async function resolveProcessPort(opts: {
  requested?: number;
  preferred?: number;
  current?: number;
  from: number;
  to: number;
}): Promise<number> {
  const pick = opts.requested ?? opts.preferred ?? opts.current;
  if (pick != null && Number.isFinite(pick) && pick > 0 && pick < 65536) {
    const port = Math.floor(pick);
    // Allow reuse of our current port (still listening from previous process until stop)
    if (opts.current === port) return port;
    const busy = await isPortListening(port);
    if (busy) {
      throw new YskError(ErrorCodes.VALIDATION, `Port ${port} is already in use`, {
        httpStatus: 409,
        details: { port },
      });
    }
    return port;
  }
  return findFreePort(opts.from, opts.to);
}

/** PHP edge mode from last deploy (publish must not overwrite php -S with dead FPM). */
export function resolvePhpEdgeMode(
  row: ProjectRow,
): 'php_fpm' | 'php_proxy' {
  const mode = String((row.last_health as { deployMode?: string } | undefined)?.deployMode ?? '');
  if (mode === 'php_builtin' || mode === 'php_proxy') return 'php_proxy';
  if (mode === 'php_fpm') return 'php_fpm';
  // Prefer FPM when no process port (production path)
  if (row.port && row.process_status && row.process_status !== 'stopped') {
    return 'php_proxy';
  }
  return 'php_fpm';
}

/**
 * Project ops result — extends shared OpsResultDto (single honesty contract).
 */
export interface OpsApplyResult extends OpsResultDto {
  projectId: string;
  pidfile?: string;
  processStatus: OpsProcessStatus;
  health?: { ok: boolean; status?: number; body?: string; ms?: number; error?: string };
  listening: boolean;
  nginxPath?: string;
  written: string[];
  /** true when process was only pidfile-spawned (not system systemd) */
  degraded?: boolean;
  apply_status?: ApplyStatus;
  deployMode?: DeployMode;
  nginxReloaded?: boolean;
  systemdUnit?: string;
  nginxStatus?: string;
  pm2App?: string;
}

export class ProjectOpsService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly host: HostExecutor,
    private readonly dataDir: string,
    private readonly audit?: AuditRepository,
  ) {}

  /**
   * Full Node deploy path:
   * 1) write app artifacts (.env, entry stub, unit)
   * 2) allocate port
   * 3) stop previous process if any
   * 4) spawn node (detached) + pidfile
   * 5) wait until port listens and HTTP returns 2xx
   * 6) rewrite nginx conf with real upstream
   * 7) persist status on project row
   */
  async deployNode(
    projectId: string,
    opts: {
      actor: string;
      port?: number;
      entry?: string;
      nodeVersion?: string;
      enableSystemd?: boolean;
      /** Prefer PM2 when not using systemd (needs YSK_EXECUTE + pm2 on PATH) */
      preferPm2?: boolean;
      healthTimeoutMs?: number;
      memoryMax?: string;
      cpuQuotaPercent?: number;
    },
  ): Promise<OpsApplyResult> {
    const row = this.require(projectId);
    if (row.runtime !== 'node') {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0249'), {
        httpStatus: 400 });
    }
    assertOsIsolationForDeploy(row, this.host, 'Deploy Node');
    await assertWithinQuota({
      host: this.host,
      projectId,
      homeDir: row.home_dir,
      quotaMb: row.quota_mb,
      action: 'Deploy' });

    const notes: string[] = [];
    const written: string[] = [];
    if (!canRunAsProjectUser(row, this.host)) {
      notes.push(
        tl('notes.auto.n1535'),
      );
    } else {
      notes.push(tl('notes.auto.t0171', { v0: (row.linux_user) }));
    }
    const entry = opts.entry ?? 'server.js';
    const port = await resolveProcessPort({
      requested: opts.port,
      preferred: row.preferred_port,
      current: row.port,
      from: 3100,
      to: 3999,
    });
    notes.push(tl('notes.auto.t0173', { v0: (port) }));

    const nodeVer = opts.nodeVersion ?? row.runtime_version ?? defaultRuntimeVersion('node');
    // Never use panel process.execPath under /root (→ systemd 203/EXEC for ysks_* users)
    const nodeResolved = resolveNodeBinary(nodeVer, this.host);
    const nodeBinary = nodeResolved.path;
    notes.push(tl('notes.auto.t0172', { v0: (nodeBinary) }));
    notes.push(...nodeResolved.notes);
    const isolatedDeploy =
      this.host.executeEnabled() && this.host.isRoot() && Boolean(row.os_provisioned);
    if (isolatedDeploy && !nodeBinaryExists(nodeBinary, this.host)) {
      notes.push(
        tl('notes.deploy.nodeMissingIsolated', { path: nodeBinary, version: nodeVer }),
      );
      this.projects.updateRuntimeState(projectId, {
        process_status: 'failed',
        status: 'failed',
        last_health: {
          ok: false,
          error: `node binary missing: ${nodeBinary}`,
          at: new Date().toISOString(),
        },
        last_deploy_at: new Date().toISOString(),
        last_deploy_notes: clipDeployNotes(notes),
      });
      return {
        ok: false,
        projectId,
        port,
        processStatus: 'failed',
        listening: false,
        notes,
        written,
        degraded: true,
        deployMode: 'none',
        requiresRoot: false,
        requiresExecute: false,
      };
    }
    const tuningEnv = tuningToEnv(loadRuntimeTuning(this.dataDir, 'node', nodeVer));
    if (Object.keys(tuningEnv).length) {
      notes.push(tl('notes.auto.t0174', { v0: (Object.keys(tuningEnv).join(', ')) }));
    }

    const preferSystemd =
      opts.enableSystemd === true ||
      (opts.enableSystemd !== false && this.host.executeEnabled() && this.host.isRoot());

    const unitName = `ysk-project-${row.linux_user}.service`;

    // Clean slate: always release both runners before starting one (systemd↔PM2 switch)
    if (this.host.executeEnabled()) {
      if (this.host.isRoot()) {
        const stopNotes = await stopAndDisableProjectUnit(this.host, unitName);
        notes.push(...stopNotes);
      }
      const pm2Stop = await applyPm2Stop({ host: this.host, linuxUser: row.linux_user });
      notes.push(...pm2Stop.notes);
    }
    await this.stopProcess(row, notes);
    // Brief settle so port is free after systemd stop (EADDRINUSE → PM2 errored)
    if (this.host.executeEnabled()) {
      await new Promise((r) => setTimeout(r, 400));
    }

    const memoryMax = opts.memoryMax ?? row.memory_max;
    const cpuQuotaPercent = opts.cpuQuotaPercent ?? row.cpu_quota_percent;
    const apply = await applyNodeHosting({
      dataDir: this.dataDir,
      projectId: row.id,
      projectName: row.name,
      linuxUser: row.linux_user,
      homeDir: row.home_dir,
      nodeVersion: nodeVer,
      entry,
      port,
      host: this.host,
      enableService: preferSystemd,
      nodeBinary,
      memoryMax,
      cpuQuotaPercent,
      limitNOFILE: 65535,
      env: tuningEnv });
    written.push(apply.envPath, apply.unitPath, apply.appDir);
    notes.push(...apply.notes);
    await chownProjectHome(this.host, row, notes);

    const appDir = apply.appDir;
    const entryPath = join(appDir, entry);
    if (!existsSync(entryPath)) {
      throw new YskError(ErrorCodes.INTERNAL, tl('notes.auto.t0175', { v0: (entryPath) }), {
        httpStatus: 500 });
    }

    mkdirSync(join(row.home_dir, 'logs'), { recursive: true });
    const pidfile = join(row.home_dir, 'app.pid');

    this.projects.updateRuntimeState(projectId, {
      port,
      pid: undefined,
      pidfile,
      process_status: 'starting',
      status: 'deploying',
      last_health: undefined,
      last_deploy_at: new Date().toISOString() });

    let pid: number | undefined;
    let deployMode: DeployMode = 'pidfile';
    let degraded = true;
    let pm2App: string | undefined;

    // Always write PM2 ecosystem (artifact only) for operators who use PM2 fleet
    const eco = writePm2Ecosystem({
      homeDir: row.home_dir,
      linuxUser: row.linux_user,
      appDir,
      entry,
      port,
      nodeBinary,
      maxMemoryRestart: memoryMax ?? row.memory_max ?? undefined,
      env: tuningEnv });
    written.push(eco.ecosystemPath);
    notes.push(...eco.notes);
    pm2App = eco.appName;
    await chownProjectHome(this.host, row, notes);

    if (preferSystemd && this.host.executeEnabled() && this.host.isRoot()) {
      // Production path: install unit and start via systemd
      const r1 = await this.host.runCommand(['cp', apply.unitPath, `/etc/systemd/system/${unitName}`]);
      const r2 = await this.host.runCommand(['systemctl', 'daemon-reload']);
      const r3 = await this.host.runCommand(['systemctl', 'enable', '--now', unitName]);
      notes.push(
        `systemd: cp exit=${r1.exitCode}, daemon-reload=${r2.exitCode}, enable=${r3.exitCode}`,
      );
      if (r1.exitCode === 0 && r3.exitCode === 0) {
        const health = await assertSystemdUnitHealthy(this.host, unitName);
        notes.push(...health.notes);
        if (health.ok && health.mainPid) {
          deployMode = 'systemd';
          degraded = false;
          pid = health.mainPid;
          writeFileSync(pidfile, `${pid}\n`, 'utf8');
          notes.push(tl('notes.auto.t0176', { v0: (unitName) }));
        } else {
          notes.push(tl('notes.auto.n0443'));
          if (!isProjectUserExecutablePath(nodeBinary)) {
            notes.push(
              tl('notes.deploy.nodeRejectedPath', {
                path: nodeBinary,
                planned: selectNodeRuntime(nodeVer).binaryPath,
              }),
            );
          } else if (!nodeBinaryExists(nodeBinary, this.host)) {
            notes.push(
              tl('notes.deploy.nodeMissing', { path: nodeBinary, version: nodeVer }),
            );
          }
          // Stop crash loops when unit is broken
          await this.host.runCommand(['systemctl', 'stop', unitName], { timeoutMs: 15_000 });
          await this.host.runCommand(['systemctl', 'reset-failed', unitName], {
            timeoutMs: 10_000,
          });
        }
      } else {
        notes.push(tl('notes.auto.n0443'));
      }
    }

    // PM2 when not on systemd (explicit enableSystemd:false or systemd failed)
    const tryPm2 =
      deployMode !== 'systemd' && opts.preferPm2 !== false && this.host.executeEnabled();

    if (tryPm2) {
      // Belt-and-suspenders: unit must stay down so PM2 can bind PORT
      if (this.host.isRoot()) {
        notes.push(...(await stopAndDisableProjectUnit(this.host, unitName)));
      }
      const pm2 = await applyPm2Start({
        host: this.host,
        homeDir: row.home_dir,
        linuxUser: row.linux_user,
        appDir,
        entry,
        port,
        nodeBinary,
        execute: true,
        maxMemoryRestart: memoryMax ?? row.memory_max ?? undefined,
        env: tuningEnv });
      notes.push(...pm2.notes);
      if (pm2.ok) {
        deployMode = 'pm2';
        degraded = false;
        pid = pm2.pid;
        if (pid) writeFileSync(pidfile, `${pid}\n`, 'utf8');
        notes.push(tl('notes.auto.t0177', { v0: (pm2.appName) }));
      } else if (!this.host.executeEnabled()) {
        notes.push(tl('notes.auto.n1143'));
      } else {
        notes.push(tl('notes.auto.n0152'));
        notes.push(
          'PM2 deploy failed — ensure systemd unit is stopped and port is free, then redeploy',
        );
      }
    }

    if (deployMode === 'pidfile') {
      notes.push(
        tl('notes.auto.n1268'),
      );
    }

    if (deployMode === 'pidfile') {
      const logOut = join(row.home_dir, 'logs', 'app.out.log');
      const logErr = join(row.home_dir, 'logs', 'app.err.log');
      let child: ChildProcess;
      try {
        const outFd = openSync(logOut, 'a');
        const errFd = openSync(logErr, 'a');
        const shellCmd = `${shellQuote(nodeBinary)} ${shellQuote(entry)}`;
        const spawned = spawnAsProjectUser({
          row,
          host: this.host,
          shellCmd,
          cwd: appDir,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            PORT: String(port),
            HOST: '127.0.0.1',
            ...tuningEnv },
          logOutFd: outFd,
          logErrFd: errFd,
          notes });
        child = spawned.child;
        if (spawned.mode === 'degraded') degraded = true;
        closeSync(outFd);
        closeSync(errFd);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.projects.updateRuntimeState(projectId, {
          process_status: 'failed',
          status: 'failed',
          last_health: { ok: false, error: msg, at: new Date().toISOString() } });
        return {
          ok: false,
          projectId,
          port,
          pidfile,
          processStatus: 'failed',
          listening: false,
          notes: [...notes, tl('notes.auto.t0178', { v0: (msg) })],
          written,
          degraded: true,
          deployMode: 'pidfile',
          requiresRoot: !this.host.isRoot(),
          requiresExecute: !this.host.executeEnabled() };
      }

      pid = child.pid;
      if (!pid) {
        this.projects.updateRuntimeState(projectId, {
          process_status: 'failed',
          status: 'failed' });
        return {
          ok: false,
          projectId,
          port,
          pidfile,
          processStatus: 'failed',
          listening: false,
          notes: [...notes, tl('notes.auto.n0620')],
          written,
          degraded: true,
          deployMode: 'pidfile' };
      }
      child.unref();
      writeFileSync(pidfile, `${pid}\n`, 'utf8');
      notes.push(tl('notes.auto.t0179', { v0: (pid), v1: (pidfile) }));
    }

    const url = `http://127.0.0.1:${port}/`;
    const health = await waitHttpOk(url, { timeoutMs: opts.healthTimeoutMs ?? 12_000 });
    const listening = await isPortListening(port);

    let processStatus: OpsProcessStatus = 'running';
    if (!health.ok || !listening) {
      processStatus = 'unhealthy';
      notes.push(
        health.ok
          ? 'HTTP ok but port check failed'
          : `Health failed after ${health.ms}ms: ${health.error ?? health.status}`,
      );
    } else {
      notes.push(
        `Health OK in ${health.ms}ms (HTTP ${health.status}) body=${JSON.stringify(health.body)}`,
      );
    }

    // Nginx with real upstream port (managed dataDir; system reload via publishNginx)
    const serverName = buildServerNameList(row.domain ?? `${row.linux_user}.local`, row.domain_aliases);
    const conf = renderNginxProxy({
      serverName,
      upstream: `http://127.0.0.1:${port}`,
      ssl: false,
      ...this.nginxRealIpOpts(row),
      forceHttps: false,
      hsts: false });
    const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
    written.push(nginxPath);
    notes.push(tl('notes.auto.t0180', { v0: (nginxPath) }));
    const live = await this.syncNginxLive(notes, written);

    const statusLabel =
      processStatus === 'running'
        ? degraded
          ? 'running_degraded'
          : 'running'
        : processStatus;

    this.projects.updateRuntimeState(projectId, {
      port,
      pid,
      pidfile,
      process_status: processStatus,
      status: statusLabel,
      nginx_config_path: nginxPath,
      last_health: {
        ok: health.ok,
        status: health.status,
        body: health.body,
        error: health.error,
        ms: health.ms,
        at: new Date().toISOString(),
        url,
        deployMode,
        degraded,
        nginxStatus: live.nginxStatus,
        nginxReloaded: live.nginxReloaded,
      },
      last_deploy_at: new Date().toISOString(),
      deploy_entry: entry,
      last_deploy_notes: clipDeployNotes(notes) });

    this.audit?.append({
      actor: opts.actor,
      action: 'project.deploy_node',
      resource: projectId,
      detail: { port, pid, health, listening, nginxPath, deployMode, degraded, ...live },
      ok: health.ok && listening });

    return {
      ok: health.ok && listening,
      projectId,
      port,
      pid,
      pidfile,
      url,
      processStatus,
      health: {
        ok: health.ok,
        status: health.status,
        body: health.body,
        ms: health.ms,
        error: health.error },
      listening,
      nginxPath,
      notes,
      written,
      degraded,
      deployMode,
      nginxReloaded: live.nginxReloaded,
      nginxStatus: live.nginxStatus,
      systemdUnit: deployMode === 'systemd' ? unitName : undefined,
      pm2App: deployMode === 'pm2' ? pm2App : undefined,
      requiresRoot: !this.host.isRoot(),
      requiresExecute: !this.host.executeEnabled() };
  }

  /**
   * Stop process via systemd / PM2 / pidfile (SIGTERM then SIGKILL).
   */
  async stopNode(projectId: string, actor: string): Promise<OpsApplyResult> {
    const row = this.require(projectId);
    const notes: string[] = [];
    const unitName = `ysk-project-${row.linux_user}.service`;
    if (this.host.executeEnabled() && this.host.isRoot()) {
      const r = await this.host.runCommand(['systemctl', 'stop', unitName], { timeoutMs: 15_000 });
      notes.push(`systemctl stop ${unitName} exit=${r.exitCode}`);
    }
    if (this.host.executeEnabled()) {
      const pm2Stop = await applyPm2Stop({ host: this.host, linuxUser: row.linux_user });
      notes.push(...pm2Stop.notes);
    }
    await this.stopProcess(row, notes);
    this.projects.updateRuntimeState(projectId, {
      pid: undefined,
      process_status: 'stopped',
      status: 'stopped',
      last_health: { ok: false, error: 'stopped', at: new Date().toISOString() } });
    this.audit?.append({
      actor,
      action: 'project.stop_node',
      resource: projectId,
      detail: { notes },
      ok: true });
    return {
      ok: true,
      projectId,
      port: row.port,
      processStatus: 'stopped',
      listening: false,
      notes,
      written: [] };
  }

  /**
   * Static site deploy: ensure public/index.html, write nginx root conf,
   * optional system conf.d sync + reload when root+EXECUTE.
   * No process spawn (no port) — status is "published" when conf written.
   */
  async deployStatic(
    projectId: string,
    opts: {
      actor: string;
      ssl?: boolean;
      reload?: boolean;
    },
  ): Promise<OpsApplyResult> {
    const row = this.require(projectId);
    if (row.runtime !== 'static' && row.runtime !== 'php') {
      // allow static deploy for static; php public/ also works as static assets
      if (row.runtime === 'node') {
        throw new YskError(
          ErrorCodes.VALIDATION,
          tl('notes.auto.n1037'),
          { httpStatus: 400 },
        );
      }
    }
    await assertWithinQuota({
      host: this.host,
      projectId,
      homeDir: row.home_dir,
      quotaMb: row.quota_mb,
      action: 'Deploy static' });
    const notes: string[] = [];
    const written: string[] = [];
    const docRoot = resolveProjectDocRoot(row);
    mkdirSync(docRoot, { recursive: true });
    const indexPath = join(docRoot, 'index.html');
    if (!existsSync(indexPath)) {
      writeFileSync(
        indexPath,
        `<!doctype html><html><head><meta charset="utf-8"><title>${row.name}</title></head>
<body><h1>${row.name}</h1><p>YSK static site</p></body></html>\n`,
        'utf8',
      );
      written.push(indexPath);
      notes.push(tl('notes.auto.t0181', { v0: (indexPath) }));
    } else {
      notes.push(tl('notes.auto.t0182', { v0: (indexPath) }));
    }

    const primary = row.domain ?? `${row.linux_user}.local`;
    const serverName = buildServerNameList(primary, row.domain_aliases);
    const wantSsl = Boolean(opts.ssl);
    const cert = resolveBestCertPaths(this.dataDir, primary);
    if (wantSsl && !cert.exists) {
      return {
        ok: false,
        projectId: row.id,
        processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
        listening: false,
        notes: [
          tl('notes.ops.sslNotReady', { domain: primary }),
          tl('notes.ops.sslGoToPage'),
        ],
        written: [],
        degraded: true,
        nginxStatus: 'ssl_cert_missing',
      };
    }
    const auth = await this.writeProjectHtpasswd(row);
    const conf = renderNginxStatic({
      serverName,
      docRoot,
      ssl: wantSsl && cert.exists,
      ...this.nginxRealIpOpts(row),
      sslCertificate: wantSsl && cert.exists ? cert.fullchain : undefined,
      sslCertificateKey: wantSsl && cert.exists ? cert.privkey : undefined,
      forceHttps: wantSsl && cert.exists && Boolean(row.force_https),
      hsts: wantSsl && cert.exists && Boolean(row.hsts),
      siteRedirectUrl: row.site_redirect_url,
      authBasicUserFile: auth.path,
      authBasicRealm: row.http_auth_user ? 'Restricted' : undefined,
      bindIp: row.bind_ip });
    notes.push(...auth.notes);
    const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
    written.push(nginxPath);
    notes.push(tl('notes.auto.t0183', { v0: (nginxPath) }));
    notes.push(tl('notes.auto.t0184', { v0: (docRoot) }));

    let nginxReloaded = false;
    const wantReload =
      opts.reload === true ||
      (opts.reload !== false && this.host.executeEnabled() && this.host.isRoot());
    if (wantReload && this.host.executeEnabled() && this.host.isRoot()) {
      const sync = await syncNginxConfigs({
        dataDir: this.dataDir,
        systemConfDir: '/etc/nginx/conf.d',
        host: this.host,
        dryRun: false });
      written.push(...sync.copied);
      notes.push(...sync.notes);
      if (sync.tested) {
        const rel = await this.host.runCommand(['systemctl', 'reload', 'nginx'], {
          timeoutMs: 15_000 });
        nginxReloaded = rel.exitCode === 0;
        notes.push(
          nginxReloaded
            ? tl('notes.auto.n0810')
            : tl('notes.nginx.reloadExit', { code: rel.exitCode }),
        );
      }
    } else if (wantReload) {
      notes.push(tl('ops.blocked.nginxReload'));
    } else {
      notes.push(tl('notes.auto.n0568'));
    }

    // Stop any leftover node/php process from previous runtime
    await this.stopProcess(row, notes);

    this.projects.updateRuntimeState(projectId, {
      port: undefined,
      pid: undefined,
      pidfile: undefined,
      process_status: 'running',
      status: nginxReloaded ? 'running' : 'published',
      nginx_config_path: nginxPath,
      last_health: {
        ok: true,
        at: new Date().toISOString(),
        deployMode: 'static_nginx',
        degraded: !nginxReloaded,
        docRoot },
      last_deploy_at: new Date().toISOString() });

    this.audit?.append({
      actor: opts.actor,
      action: 'project.deploy_static',
      resource: projectId,
      detail: { nginxPath, docRoot, nginxReloaded },
      ok: true });

    return {
      ok: true,
      projectId,
      processStatus: 'running',
      listening: false,
      nginxPath,
      notes,
      written,
      degraded: !nginxReloaded,
      deployMode: 'none',
      nginxReloaded,
      requiresRoot: !this.host.isRoot(),
      requiresExecute: !this.host.executeEnabled() };
  }

  /**
   * Live health check against stored port; updates last_health.
   */
  async health(projectId: string): Promise<OpsApplyResult> {
    const row = this.require(projectId);
    const port = row.port;
    if (!port) {
      return {
        ok: false,
        projectId,
        processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
        listening: false,
        notes: [tl('notes.auto.n0703')],
        written: [] };
    }
    const url = `http://127.0.0.1:${port}/`;
    const listening = await isPortListening(port);
    const health = await checkHttp(url);
    let processStatus: OpsProcessStatus = 'stopped';
    if (listening && health.ok) processStatus = 'running';
    else if (listening) processStatus = 'unhealthy';
    else if (row.pid && isPidAlive(row.pid)) processStatus = 'unhealthy';

    this.projects.updateRuntimeState(projectId, {
      process_status: processStatus,
      status: processStatus,
      last_health: {
        ok: health.ok,
        status: health.status,
        body: health.body,
        error: health.error,
        ms: health.ms,
        at: new Date().toISOString(),
        url } });

    return {
      ok: health.ok && listening,
      projectId,
      port,
      pid: row.pid,
      pidfile: row.pidfile,
      url,
      processStatus,
      health: {
        ok: health.ok,
        status: health.status,
        body: health.body,
        ms: health.ms,
        error: health.error },
      listening,
      nginxPath: row.nginx_config_path,
      notes: [
        listening ? `Port ${port} is listening` : `Port ${port} is not listening`,
        health.ok ? `HTTP OK ${health.status}` : `HTTP fail: ${health.error ?? health.status}`,
      ],
      written: [] };
  }

  /** Write htpasswd under dataDir when project has HTTP basic auth credentials. */
  private async writeProjectHtpasswd(
    row: ProjectRow,
  ): Promise<{ path?: string; notes: string[] }> {
    if (!row.http_auth_user?.trim() || !row.http_auth_pass) {
      return { notes: [] };
    }
    const htDir = join(this.dataDir, 'nginx', 'htpasswd');
    mkdirSync(htDir, { recursive: true });
    const path = join(htDir, `${row.linux_user}.htpasswd`);
    const hashR = await this.host.runCommand(
      ['openssl', 'passwd', '-apr1', row.http_auth_pass],
      { timeoutMs: 5_000 },
    );
    const hash =
      hashR.exitCode === 0 && hashR.stdout.trim()
        ? hashR.stdout.trim()
        : `{PLAIN}${row.http_auth_pass}`;
    writeFileSync(path, `${row.http_auth_user.trim()}:${hash}\n`, 'utf8');
    return {
      path,
      notes: [tl('notes.auto.t0185', { v0: (row.http_auth_user.trim()), v1: (path) })] };
  }

  /**
   * Write/update nginx conf for project and optionally sync to system conf.d.
   * Runtime-aware: static / php-fpm / reverse-proxy.
   */
  async publishNginx(
    projectId: string,
    opts: {
      actor: string;
      systemConfDir?: string;
      ssl?: boolean;
      /** When true (default if EXECUTE), run nginx -t + reload */
      reload?: boolean;
      forceHttps?: boolean;
      hsts?: boolean;
    },
  ): Promise<OpsApplyResult> {
    const row = this.require(projectId);
    if (row.status === 'suspended') {
      return this.publishSuspendedNginx(projectId, opts.actor);
    }
    const primary = row.domain ?? `${row.linux_user}.local`;
    const serverName = buildServerNameList(primary, row.domain_aliases);
    // Prefer dataDir certs, then /etc/letsencrypt/live, then store paths.
    // Auto-enable SSL when cert files exist unless caller explicitly sets ssl:false.
    // (goLive used to pass only reload:true → HTTP-only conf while orphan SSL vhosts
    // from deleted projects kept serving 443 → 502 Bad Gateway.)
    const cert = resolveBestCertPaths(this.dataDir, primary);
    const wantSsl = opts.ssl !== undefined ? opts.ssl : cert.exists;
    const forceHttps = opts.forceHttps ?? Boolean(row.force_https);
    const hsts = opts.hsts ?? Boolean(row.hsts);
    if (opts.forceHttps !== undefined || opts.hsts !== undefined) {
      this.projects.updateMeta(projectId, {
        force_https: forceHttps,
        hsts });
    }
    // Never emit listen 443 / ssl_certificate when files are missing (breaks nginx -t).
    if (wantSsl && !cert.exists) {
      return {
        ok: false,
        projectId,
        processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
        listening: false,
        notes: [
          tl('notes.ops.sslNotReadyDetail', { domain: primary }),
          tl('notes.ops.sslGoToPage'),
          tl('notes.ops.sslRejectWrite'),
        ],
        written: [],
        degraded: true,
        nginxStatus: 'ssl_cert_missing',
      };
    }
    const auth = await this.writeProjectHtpasswd(row);
    const authBasicUserFile = auth.path;
    const sslCert = wantSsl && cert.exists ? cert.fullchain : undefined;
    const sslKey = wantSsl && cert.exists ? cert.privkey : undefined;
    const realIpOpts = this.nginxRealIpOpts(row);
    const commonSsl = {
      ssl: Boolean(wantSsl && cert.exists),
      ...realIpOpts,
      sslCertificate: sslCert,
      sslCertificateKey: sslKey,
      forceHttps: wantSsl && cert.exists && forceHttps,
      hsts: wantSsl && cert.exists && hsts,
      siteRedirectUrl: row.site_redirect_url,
      authBasicUserFile,
      authBasicRealm: row.http_auth_user ? 'Restricted' : undefined,
      bindIp: row.bind_ip };

    const notes: string[] = [...auth.notes];
    const written: string[] = [];
    let conf: string;
    let kind = 'proxy';
    let port = row.port;

    if (row.runtime === 'static') {
      kind = 'static';
      const docRoot = resolveProjectDocRoot(row);
      conf = renderNginxStatic({
        serverName,
        docRoot,
        ...commonSsl });
    } else if (row.runtime === 'php') {
      const edge = resolvePhpEdgeMode(row);
      if (edge === 'php_proxy') {
        if (!port) {
          return {
            ok: false,
            projectId,
            processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
            listening: false,
            notes: [
              ...notes,
              'PHP proxy mode needs a process port — deploy first (or use FPM production path)',
            ],
            written,
            degraded: true,
            nginxStatus: 'needs_deploy',
          };
        }
        kind = 'php-proxy';
        conf = renderNginxProxy({
          serverName,
          upstream: `http://127.0.0.1:${port}`,
          ...commonSsl });
      } else {
      // Nginx → Apache backend → PHP-FPM (never direct fastcgi from nginx)
      kind = 'php-apache';
      const docRoot = resolveProjectDocRoot(row);
      const phpVer = selectPhpRuntime(row.runtime_version || '8.2').version;
      const fpmSocket = `/run/php/php${phpVer}-fpm-${row.linux_user}.sock`;
      conf = renderNginxPhpFpm({
        serverName,
        docRoot,
        fpmSocket,
        apacheUpstream: apacheBackendUpstream(),
        ...commonSsl });

      }
    } else {
      // Process runtimes: require a real port — never invent 3000/3100
      if (!port) {
        return {
          ok: false,
          projectId,
          processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
          listening: false,
          notes: [
            ...notes,
            'No process port — deploy the app before publishing nginx proxy',
          ],
          written,
          degraded: true,
          nginxStatus: 'needs_deploy',
        };
      }
      kind = 'proxy';
      conf = renderNginxProxy({
        serverName,
        upstream: `http://127.0.0.1:${port}`,
        ...commonSsl });
    }

    const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
    written.push(nginxPath);
    notes.push(tl('notes.email.wroteNginx', { nginxPath }));
    notes.push(tl('notes.auto.t0186', { v0: kind }));
    if (serverName.includes(' ')) notes.push(`server_name：${serverName}`);
    if (wantSsl && forceHttps) notes.push(tl('notes.auto.n0829'));
    if (wantSsl && hsts) notes.push(tl('notes.auto.n0745'));
    if (row.site_redirect_url) notes.push(tl('notes.auto.t0187', { v0: row.site_redirect_url }));
    if (wantSsl && cert.exists) {
      notes.push(tl('notes.auto.t0188', { v0: cert.fullchain }));
    } else if (wantSsl) {
      notes.push(tl('notes.auto.t0189', { v0: primary }));
    }

    const wantReload =
      opts.reload ??
      Boolean(this.host.executeEnabled() && this.host.isRoot());
    const live = await this.syncNginxLive(notes, written, {
      systemConfDir: opts.systemConfDir,
      reload: wantReload,
    });

    this.projects.updateRuntimeState(projectId, {
      nginx_config_path: nginxPath,
      last_health: {
        ...(row.last_health ?? {}),
        nginxStatus: live.nginxStatus,
        nginxReloaded: live.nginxReloaded,
        edgeKind: kind,
        at: new Date().toISOString() } });
    this.projects.updateNginxPath(projectId, nginxPath);

    const reloadBlocked = wantReload && live.nginxStatus === 'requires_execute';
    const reloadFailed =
      wantReload &&
      (live.nginxStatus === 'nginx_t_failed' ||
        live.nginxStatus.startsWith('reload_failed'));
    const ok = !reloadBlocked && !reloadFailed;

    this.audit?.append({
      actor: opts.actor,
      action: 'project.publish_nginx',
      resource: projectId,
      detail: {
        nginxPath,
        port,
        kind,
        nginxReloaded: live.nginxReloaded,
        nginxStatus: live.nginxStatus,
        serverName,
        forceHttps,
        hsts,
        ok },
      ok });
    return {
      ok,
      projectId,
      port,
      processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
      listening: port ? await isPortListening(port) : false,
      nginxPath,
      notes: [
        ...notes,
        reloadBlocked
          ? tl('notes.auto.n1227')
          : reloadFailed
            ? tl('notes.auto.n1218')
            : live.nginxReloaded
              ? tl('notes.auto.n0001')
              : tl('notes.auto.n0007'),
      ],
      written,
      nginxReloaded: live.nginxReloaded,
      nginxStatus: live.nginxStatus,
      requiresExecute: !this.host.executeEnabled(),
      requiresRoot: !this.host.isRoot(),
      degraded: !live.nginxReloaded };
  }

  /**
   * Sync managed conf.d → system and optionally nginx -t + reload.
   */
  private async syncNginxLive(
    notes: string[],
    written: string[],
    opts?: { systemConfDir?: string; reload?: boolean },
  ): Promise<{ nginxReloaded: boolean; nginxStatus: string }> {
    const systemDir =
      opts?.systemConfDir ??
      (this.host.executeEnabled() && this.host.isRoot() ? '/etc/nginx/conf.d' : undefined);
    const sync = await syncNginxConfigs({
      dataDir: this.dataDir,
      systemConfDir: systemDir,
      host: this.host,
    });
    notes.push(...sync.notes);
    written.push(...sync.copied);

    let nginxReloaded = false;
    let nginxStatus = systemDir ? 'synced' : 'managed_only';
    const wantReload =
      opts?.reload ?? Boolean(systemDir && this.host.executeEnabled() && this.host.isRoot());

    if (wantReload && this.host.executeEnabled()) {
      const t = await this.host.runCommand(['nginx', '-t'], { timeoutMs: 10_000 });
      notes.push(
        t.exitCode === 0
          ? tl('notes.nginx.configOk')
          : tl('notes.tpl.nginxConfigFailed', { detail: (t.stderr || t.stdout).trim() }),
      );
      if (t.exitCode === 0) {
        const r = await this.host.runCommand(['systemctl', 'reload', 'nginx'], {
          timeoutMs: 15_000,
        });
        nginxReloaded = r.exitCode === 0;
        nginxStatus = nginxReloaded ? 'reloaded' : `reload_failed:${r.stderr}`;
        notes.push(
          nginxReloaded
            ? tl('notes.nginx.reloaded')
            : tl('notes.auto.t0190', { v0: r.stderr }),
        );
      } else {
        nginxStatus = 'nginx_t_failed';
      }
    } else if (wantReload) {
      notes.push(tl('ops.blocked.nginxReload'));
      nginxStatus = 'requires_execute';
    }
    return { nginxReloaded, nginxStatus };
  }

  /**
   * After create+template (or explicit goLive): deploy by runtime then publish nginx.
   * Does not rollback project row on failure — returns honest notes.
   */
  async goLive(
    projectId: string,
    opts: { actor: string; port?: number },
  ): Promise<{
    ok: boolean;
    deploy?: OpsApplyResult;
    publish?: OpsApplyResult;
    notes: string[];
  }> {
    const row = this.require(projectId);
    const notes: string[] = [];
    let deploy: OpsApplyResult | undefined;
    let publish: OpsApplyResult | undefined;

    const persistNotes = (ok: boolean) => {
      this.projects.updateRuntimeState(projectId, {
        last_deploy_notes: clipDeployNotes(notes),
        last_deploy_at: new Date().toISOString(),
        last_health: {
          ...(this.require(projectId).last_health ?? {}),
          goLiveOk: ok,
          goLiveAt: new Date().toISOString(),
          at: new Date().toISOString(),
        },
      });
      this.audit?.append({
        actor: opts.actor,
        action: 'project.go_live',
        resource: projectId,
        detail: {
          ok,
          deployOk: deploy?.ok,
          publishOk: publish?.ok,
          notes: clipDeployNotes(notes),
        },
        ok,
      });
    };

    try {
      if (row.runtime === 'php') {
        deploy = await this.deployPhp(projectId, {
          actor: opts.actor,
          port: opts.port ?? row.preferred_port,
        });
      } else if (row.runtime === 'static') {
        deploy = await this.deployStatic(projectId, {
          actor: opts.actor,
          reload: false,
        });
      } else if (isProcessRuntime(row.runtime) && row.runtime !== 'node') {
        deploy = await this.deployProcess(projectId, {
          actor: opts.actor,
          port: opts.port ?? row.preferred_port,
        });
      } else {
        deploy = await this.deployNode(projectId, {
          actor: opts.actor,
          port: opts.port ?? row.preferred_port,
        });
      }
      notes.push(...(deploy.notes ?? []));
      if (!deploy.ok) {
        notes.push(tl('notes.goLive.deployIncomplete'));
        persistNotes(false);
        return { ok: false, deploy, notes };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notes.push(tl('notes.goLive.deployFailed', { detail: msg }));
      persistNotes(false);
      return { ok: false, notes };
    }

    // deploy* already wrote conf; publish re-renders with SSL flags + ensures system sync
    try {
      publish = await this.publishNginx(projectId, {
        actor: opts.actor,
        reload: true,
      });
      notes.push(...(publish.notes ?? []));
      if (!publish.ok) {
        notes.push(tl('notes.goLive.publishIncomplete'));
        persistNotes(false);
        return { ok: false, deploy, publish, notes };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notes.push(tl('notes.goLive.publishFailed', { detail: msg }));
      persistNotes(false);
      return { ok: false, deploy, notes };
    }

    const ok = true;
    persistNotes(ok);
    return { ok, deploy, publish, notes };
  }

  /**
   * Suspend: stop process + publish 503 vhost + status=suspended.
   */
  async suspend(projectId: string, actor: string): Promise<OpsApplyResult> {
    const row = this.require(projectId);
    const notes: string[] = [];
    const stop = await this.stopNode(projectId, actor);
    notes.push(...(stop.notes ?? []));
    const pub = await this.publishSuspendedNginx(projectId, actor);
    notes.push(...pub.notes);
    this.projects.updateRuntimeState(projectId, {
      status: 'suspended',
      process_status: 'stopped',
      nginx_config_path: pub.nginxPath });
    this.audit?.append({
      actor,
      action: 'project.suspend',
      resource: projectId,
      detail: { domain: row.domain },
      ok: true });
    return {
      ok: true,
      projectId,
      processStatus: 'stopped',
      listening: false,
      nginxPath: pub.nginxPath,
      notes: [tl('notes.auto.n0691'), ...notes],
      written: pub.written,
      degraded: pub.degraded,
      requiresExecute: pub.requiresExecute,
      requiresRoot: pub.requiresRoot,
      nginxReloaded: pub.nginxReloaded,
      nginxStatus: pub.nginxStatus };
  }

  /**
   * Unsuspend: clear suspended flag and re-publish normal nginx (no SSL by default).
   */
  async unsuspend(projectId: string, actor: string): Promise<OpsApplyResult> {
    this.require(projectId);
    this.projects.updateMeta(projectId, { status: 'stopped' });
    this.projects.updateRuntimeState(projectId, {
      status: 'stopped',
      process_status: 'stopped' });
    const pub = await this.publishNginx(projectId, { actor, ssl: false });
    this.audit?.append({
      actor,
      action: 'project.unsuspend',
      resource: projectId,
      detail: {},
      ok: true });
    return {
      ...pub,
      notes: [tl('notes.auto.n0690'), ...pub.notes] };
  }

  private async publishSuspendedNginx(
    projectId: string,
    actor: string,
  ): Promise<OpsApplyResult> {
    const row = this.require(projectId);
    const serverName = buildServerNameList(
      row.domain ?? `${row.linux_user}.local`,
      row.domain_aliases,
    );
    const conf = renderNginxSuspended(serverName);
    const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
    const systemDir =
      this.host.executeEnabled() && this.host.isRoot() ? '/etc/nginx/conf.d' : undefined;
    const sync = await syncNginxConfigs({
      dataDir: this.dataDir,
      systemConfDir: systemDir,
      host: this.host });
    const notes = [tl('notes.auto.t0191', { v0: (nginxPath) }), ...sync.notes];
    let nginxReloaded = false;
    let nginxStatus = 'managed_only';
    if (systemDir && this.host.executeEnabled()) {
      const t = await this.host.runCommand(['nginx', '-t'], { timeoutMs: 10_000 });
      if (t.exitCode === 0) {
        const r = await this.host.runCommand(['systemctl', 'reload', 'nginx'], { timeoutMs: 15_000 });
        nginxReloaded = r.exitCode === 0;
        nginxStatus = nginxReloaded ? 'reloaded' : `reload_failed`;
      } else {
        nginxStatus = 'nginx_t_failed';
      }
    }
    this.projects.updateNginxPath(projectId, nginxPath);
    void actor;
    return {
      ok: true,
      projectId,
      processStatus: 'stopped',
      listening: false,
      nginxPath,
      notes,
      written: [nginxPath, ...sync.copied],
      nginxReloaded,
      nginxStatus,
      requiresExecute: !this.host.executeEnabled(),
      requiresRoot: !this.host.isRoot(),
      degraded: !nginxReloaded };
  }

  /**
   * Live status from pidfile / systemd / port (system truth).
   */
  async liveStatus(projectId: string): Promise<{
    projectId: string;
    processStatus: OpsProcessStatus;
    port?: number;
    pid?: number;
    listening: boolean;
    pidAlive: boolean;
    systemdActive?: string;
    degraded: boolean;
    deployMode: string;
    lastHealth?: Record<string, unknown>;
    osProvisioned: boolean;
    linuxUser: string;
  }> {
    const row = this.require(projectId);
    const port = row.port;
    const listening = port ? await isPortListening(port) : false;
    const pid = row.pid;
    const pidAlive = pid ? isPidAlive(pid) : false;
    let systemdActive: string | undefined;
    const unitName = `ysk-project-${row.linux_user}.service`;
    if (this.host.pathExists('/bin/systemctl') || this.host.pathExists('/usr/bin/systemctl')) {
      const r = await this.host.runCommand(['systemctl', 'is-active', unitName], { timeoutMs: 5_000 });
      systemdActive = (r.stdout || r.stderr || '').trim() || `exit_${r.exitCode}`;
    }
    let processStatus: OpsProcessStatus = (row.process_status as OpsProcessStatus) ?? 'stopped';
    if (listening) processStatus = 'running';
    else if (pidAlive) processStatus = 'unhealthy';
    let deployMode = 'pidfile_or_none';
    if (systemdActive === 'active') deployMode = 'systemd';
    else if (row.last_health && typeof row.last_health === 'object') {
      const dm = (row.last_health as { deployMode?: string }).deployMode;
      if (dm === 'pm2' || dm === 'pidfile' || dm === 'systemd') deployMode = dm;
    }
    const degraded = deployMode !== 'systemd' && deployMode !== 'pm2';
    return {
      projectId,
      processStatus,
      port,
      pid,
      listening,
      pidAlive,
      systemdActive,
      degraded,
      deployMode,
      lastHealth: row.last_health,
      osProvisioned: row.os_provisioned,
      linuxUser: row.linux_user };
  }

  /**
   * Git clone/pull into project app dir, then redeploy runtime (all kinds).
   */
  async gitDeploy(
    projectId: string,
    opts: {
      actor: string;
      gitUrl?: string;
      branch?: string;
      redeploy?: boolean;
      depth?: number;
      entry?: string;
      skipBuild?: boolean;
    },
  ): Promise<OpsApplyResult & { git?: Awaited<ReturnType<typeof gitSync>> }> {
    const row = this.require(projectId);
    const gitUrl = opts.gitUrl ?? row.git_url;
    if (!gitUrl) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1414'), {
        httpStatus: 400 });
    }
    const appDir = join(row.home_dir, 'app');
    const git = await gitSync({
      host: this.host,
      gitUrl,
      targetDir: appDir,
      branch: opts.branch ?? row.git_branch,
      depth: opts.depth ?? 1 });
    this.projects.updateRuntimeState(projectId, {
      git_url: gitUrl,
      git_branch: git.branch ?? opts.branch,
      git_commit: git.commit });
    const notes = [...git.notes];
    if (git.ok) {
      await chownProjectHome(this.host, row, notes);
    }
    const savedEntry = opts.entry?.trim() || row.deploy_entry?.trim() || undefined;
    let redeployResult: OpsApplyResult | undefined;
    if (git.ok && opts.redeploy !== false) {
      if (row.runtime === 'node') {
        redeployResult = await this.deployNode(projectId, {
          actor: opts.actor,
          entry: savedEntry });
        notes.push(...redeployResult.notes);
      } else if (row.runtime === 'static') {
        redeployResult = await this.deployStatic(projectId, { actor: opts.actor });
        notes.push(...redeployResult.notes);
      } else if (row.runtime === 'php') {
        redeployResult = await this.deployPhp(projectId, { actor: opts.actor });
        notes.push(...redeployResult.notes);
      } else if (isProcessRuntime(row.runtime)) {
        redeployResult = await this.deployProcess(projectId, {
          actor: opts.actor,
          entry: savedEntry,
          skipBuild: opts.skipBuild });
        notes.push(...redeployResult.notes);
      } else {
        notes.push(tl('notes.auto.t0192', { v0: (row.runtime) }));
      }
    }
    this.audit?.append({
      actor: opts.actor,
      action: 'project.git_deploy',
      resource: projectId,
      detail: { git, redeploy: Boolean(redeployResult) },
      ok: git.ok && (redeployResult?.ok ?? true) });
    return {
      ok: git.ok && (redeployResult?.ok ?? true),
      projectId,
      port: redeployResult?.port ?? row.port,
      pid: redeployResult?.pid ?? row.pid,
      url: redeployResult?.url,
      processStatus: redeployResult?.processStatus ?? ((row.process_status as OpsProcessStatus) || 'stopped'),
      listening: redeployResult?.listening ?? false,
      nginxPath: redeployResult?.nginxPath ?? row.nginx_config_path,
      notes,
      written: redeployResult?.written ?? [],
      git,
      degraded: redeployResult?.degraded ?? true };
  }

  /**
   * Write env vars to app/.env and store on project.
   */
  setEnv(
    projectId: string,
    envVars: Record<string, string>,
    actor: string,
  ): OpsApplyResult {
    const row = this.require(projectId);
    const appDir = join(row.home_dir, 'app');
    mkdirSync(appDir, { recursive: true });
    const merged = { ...(row.env_vars ?? {}), ...envVars };
    // remove empty keys
    for (const [k, v] of Object.entries(merged)) {
      if (v === '' || v === undefined) delete merged[k];
    }
    const envPath = join(appDir, '.env');
    const lines = Object.entries(merged).map(([k, v]) => `${k}=${String(v).replace(/\n/g, ' ')}`);
    writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
    this.projects.updateRuntimeState(projectId, { env_vars: merged });
    this.audit?.append({
      actor,
      action: 'project.set_env',
      resource: projectId,
      detail: { keys: Object.keys(merged) },
      ok: true });
    return {
      ok: true,
      projectId,
      processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
      listening: false,
      notes: [tl('notes.auto.t0193', { v0: (envPath), v1: (Object.keys(merged).length) })],
      written: [envPath] };
  }

  /**
   * Tar backup of project home under dataDir/backups.
   */
  async backup(projectId: string, actor: string): Promise<OpsApplyResult & { archivePath?: string }> {
    const row = this.require(projectId);
    const r = await backupProject({
      host: this.host,
      dataDir: this.dataDir,
      projectId,
      homeDir: row.home_dir });
    if (r.ok && r.archivePath) {
      this.projects.updateRuntimeState(projectId, {
        last_backup_path: r.archivePath,
        last_backup_at: new Date().toISOString() });
    }
    this.audit?.append({
      actor,
      action: 'project.backup',
      resource: projectId,
      detail: r,
      ok: r.ok });
    return {
      ok: r.ok,
      projectId,
      processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
      listening: false,
      notes: r.notes,
      written: r.archivePath ? [r.archivePath] : [],
      archivePath: r.archivePath };
  }

  /**
   * PHP deploy dual-mode:
   * - production: Nginx → Apache backend → PHP-FPM (root + YSK_EXECUTE)
   * - degraded: `php -S` + nginx proxy (verifiable without root)
   */
  async deployPhp(
    projectId: string,
    opts: {
      actor: string;
      port?: number;
      phpVersion?: string;
      enableApache?: boolean;
      /** Prefer production Apache+FPM path (default true when root+EXECUTE) */
      preferFpm?: boolean;
      /** Force php -S even if FPM/Apache available */
      forceBuiltin?: boolean;
      healthTimeoutMs?: number;
    },
  ): Promise<OpsApplyResult> {
    const row = this.require(projectId);
    if (row.runtime !== 'php' && row.runtime !== 'static') {
      if (row.runtime === 'node') {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1036'), {
          httpStatus: 400 });
      }
    }
    // PHP production paths require OS user (FPM pool runs as project user)
    if (row.runtime === 'php') {
      assertOsIsolationForDeploy(row, this.host, 'Deploy PHP');
    }
    await assertWithinQuota({
      host: this.host,
      projectId,
      homeDir: row.home_dir,
      quotaMb: row.quota_mb,
      action: 'Deploy PHP' });
    const notes: string[] = [];
    const written: string[] = [];
    if (row.runtime === 'php' && canRunAsProjectUser(row, this.host)) {
      notes.push(tl('notes.auto.t0194', { v0: (row.linux_user) }));
    } else if (row.runtime === 'php') {
      notes.push(tl('notes.auto.n0148'));
    }
    let port: number;
    try {
      port = await resolveProcessPort({
        requested: opts.port,
        preferred: row.preferred_port,
        current: row.port,
        from: 8100,
        to: 8999,
      });
    } catch {
      // FPM path may not need a port; only allocate when falling back to php -S
      port = opts.port ?? row.port ?? (await findFreePort(8100, 8999));
    }
    const docRoot = resolveProjectDocRoot(row);
    mkdirSync(docRoot, { recursive: true });
    const domain = row.domain ?? `${row.linux_user}.local`;
    const aliases = (row.domain_aliases || [])
      .map((a) => String(a).trim())
      .filter(Boolean);

    const phpVersion = opts.phpVersion ?? row.runtime_version ?? '8.2';
    const phpRt = selectPhpRuntime(phpVersion);
    if (opts.phpVersion && opts.phpVersion !== row.runtime_version) {
      this.projects.updateMeta(projectId, { runtime_version: phpRt.version });
      notes.push(tl('notes.auto.t0195', { v0: (phpRt.version) }));
    }
    // Production = Nginx → Apache → FPM (default on when root+EXECUTE)
    const canProd =
      this.host.executeEnabled() &&
      this.host.isRoot() &&
      opts.forceBuiltin !== true &&
      opts.preferFpm !== false;

    // FPM first so Apache SetHandler sock exists when site reloads
    const mergedIni = mergePhpIni(
      loadPhpIniSettings(this.dataDir, phpVersion),
      loadProjectPhpIni(this.dataDir, projectId, phpVersion),
    );
    const adminValueLines = renderPhpAdminValueLines(mergedIni);
    if (adminValueLines.length) {
      notes.push(tl('notes.auto.t0196', { v0: (adminValueLines.length) }));
    }
    const fpm = await applyPhpFpmPool({
      dataDir: this.dataDir,
      poolName: row.linux_user,
      linuxUser: row.linux_user,
      phpVersion,
      host: this.host,
      enable: canProd,
      adminValueLines });
    written.push(...fpm.written);
    notes.push(...fpm.notes);

    // Apache vhost always enabled on production path (Nginx must proxy via Apache)
    const apply = await applyPhpHosting({
      dataDir: this.dataDir,
      domain,
      serverAliases: aliases,
      docRoot,
      phpVersion,
      poolName: row.linux_user,
      host: this.host,
      enableSite: canProd || opts.enableApache === true,
      projects: this.projects.list().map((p) => ({ ...p }) as Record<string, unknown>),
    });
    await chownProjectHome(this.host, row, notes);
    // Re-apply ysk-web so Apache/www-data can read DocumentRoot after chown
    const wg = await applyProjectWebGroupAccess({
      host: this.host,
      linuxUser: row.linux_user,
      linuxGroup: row.linux_group,
      homeDir: row.home_dir,
    });
    notes.push(...wg.notes);
    written.push(...apply.written);
    notes.push(...apply.notes);

    await this.stopProcess(row, notes);

    // —— Production: FPM + Apache site → Nginx proxy_pass Apache ——
    if (fpm.enabled && apply.siteEnabled) {
      const fpmSocket =
        `/run/php/php${phpRt.version}-fpm-${row.linux_user}.sock`;
      const authPhp = await this.writeProjectHtpasswd(row);
      const certProd = resolveBestCertPaths(this.dataDir, domain);
      const conf = renderNginxPhpFpm({
        serverName: buildServerNameList(domain, row.domain_aliases),
        docRoot,
        fpmSocket,
        apacheUpstream: apply.apacheUpstream,
        ssl: certProd.exists,
        sslCertificate: certProd.exists ? certProd.fullchain : undefined,
        sslCertificateKey: certProd.exists ? certProd.privkey : undefined,
        ...this.nginxRealIpOpts(row),
        forceHttps: certProd.exists && Boolean(row.force_https),
        hsts: certProd.exists && Boolean(row.hsts),
        siteRedirectUrl: row.site_redirect_url,
        authBasicUserFile: authPhp.path,
        authBasicRealm: row.http_auth_user ? 'Restricted' : undefined,
        bindIp: row.bind_ip });
      notes.push(...authPhp.notes);
      const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
      written.push(nginxPath);
      notes.push(tl('notes.auto.t0197', { v0: (nginxPath) }));
      notes.push(`nginx proxy_pass ${apply.apacheUpstream} → Apache → FPM ${fpmSocket}`);

      // best-effort system sync + nginx -t + reload
      let nginxReloaded = false;
      if (this.host.executeEnabled() && this.host.isRoot()) {
        const sync = await syncNginxConfigs({
          dataDir: this.dataDir,
          systemConfDir: '/etc/nginx/conf.d',
          host: this.host,
          dryRun: false });
        written.push(...sync.copied);
        notes.push(...sync.notes);
        if (sync.tested) {
          const rel = await this.host.runCommand(['systemctl', 'reload', 'nginx'], {
            timeoutMs: 15_000 });
          nginxReloaded = rel.exitCode === 0;
          notes.push(
            nginxReloaded
              ? tl('notes.nginx.reloaded')
              : tl('notes.auto.t0198', { v0: (rel.exitCode), v1: (rel.stderr) }),
          );
        }
      }

      this.projects.updateRuntimeState(projectId, {
        port: undefined,
        pid: undefined,
        pidfile: undefined,
        process_status: 'running',
        status: 'running',
        nginx_config_path: nginxPath,
        last_health: {
          ok: true,
          at: new Date().toISOString(),
          deployMode: 'php_apache_fpm',
          degraded: false,
          fpmSocket,
          apacheUpstream: apply.apacheUpstream,
          nginxReloaded },
        last_deploy_at: new Date().toISOString() });

      this.audit?.append({
        actor: opts.actor,
        action: 'project.deploy_php',
        resource: projectId,
        detail: {
          deployMode: 'php_apache_fpm',
          fpmSocket,
          apacheUpstream: apply.apacheUpstream,
          nginxPath,
          nginxReloaded,
        },
        ok: true });

      return {
        ok: true,
        projectId,
        processStatus: 'running',
        listening: false,
        nginxPath,
        notes: [
          ...notes,
          'Production: Nginx → Apache → PHP-FPM — verify via public hostname after reload',
        ],
        written,
        degraded: false,
        deployMode: 'none',
        nginxReloaded };
    }

    if (canProd && (!fpm.enabled || !apply.siteEnabled)) {
      notes.push(
        `Production path incomplete (fpm=${fpm.enabled} apacheSite=${apply.siteEnabled}) — falling back to php -S (degraded)`,
      );
    } else {
      notes.push(
        tl('notes.auto.n1269'),
      );
    }

    // —— Degraded path: php -S ——
    const phpBin = await resolvePhpBinary(this.host, phpVersion);
    if (!phpBin) {
      this.projects.updateRuntimeState(projectId, {
        port,
        process_status: 'failed',
        status: 'failed' });
      return {
        ok: false,
        projectId,
        port,
        processStatus: 'failed',
        listening: false,
        notes: [...notes, tl('notes.auto.n0374')],
        written,
        degraded: true,
        deployMode: 'pidfile' };
    }

    const pidfile = join(row.home_dir, 'app.pid');
    const logOut = join(row.home_dir, 'logs', 'php.out.log');
    const logErr = join(row.home_dir, 'logs', 'php.err.log');
    mkdirSync(join(row.home_dir, 'logs'), { recursive: true });

    const outFd = openSync(logOut, 'a');
    const errFd = openSync(logErr, 'a');
    const phpShell = `${shellQuote(phpBin)} -S 127.0.0.1:${port} -t ${shellQuote(docRoot)}`;
    const { child, mode: phpMode } = spawnAsProjectUser({
      row,
      host: this.host,
      shellCmd: phpShell,
      cwd: docRoot,
      env: { ...process.env, PORT: String(port) },
      logOutFd: outFd,
      logErrFd: errFd,
      notes });
    closeSync(outFd);
    closeSync(errFd);
    const pid = child.pid;
    if (!pid) {
      return {
        ok: false,
        projectId,
        port,
        processStatus: 'failed',
        listening: false,
        notes: [...notes, tl('notes.auto.n0147')],
        written,
        degraded: true,
        deployMode: 'pidfile' };
    }
    child.unref();
    writeFileSync(pidfile, `${pid}\n`, 'utf8');
    notes.push(
      tl('notes.auto.t0199', { v0: (pid), v1: (port) }) +
        (phpMode === 'isolated' ? `（user=${row.linux_user}）` : '（degraded）'),
    );
    await chownProjectHome(this.host, row, notes);

    const url = `http://127.0.0.1:${port}/`;
    // acceptRedirect: Roundcube force_https returns 3xx to public HTTPS; following breaks loopback health
    const health = await waitHttpOk(url, {
      timeoutMs: opts.healthTimeoutMs ?? 12_000,
      acceptRedirect: true,
    });
    const listening = await isPortListening(port);
    const processStatus: OpsProcessStatus =
      health.ok && listening ? 'running' : 'unhealthy';

    // Proxy nginx for degraded path (local health via php -S)
    const certDeg = resolveBestCertPaths(this.dataDir, domain);
    const conf = renderNginxProxy({
      serverName: buildServerNameList(domain, row.domain_aliases),
      upstream: `http://127.0.0.1:${port}`,
      ssl: certDeg.exists,
      sslCertificate: certDeg.exists ? certDeg.fullchain : undefined,
      sslCertificateKey: certDeg.exists ? certDeg.privkey : undefined,
      ...this.nginxRealIpOpts(row),
      forceHttps: certDeg.exists && Boolean(row.force_https),
      hsts: certDeg.exists && Boolean(row.hsts),
      bindIp: row.bind_ip,
    });
    const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
    written.push(nginxPath);
    const live = await this.syncNginxLive(notes, written);

    this.projects.updateRuntimeState(projectId, {
      port,
      pid,
      pidfile,
      process_status: processStatus,
      status: processStatus === 'running' ? 'running_degraded' : processStatus,
      nginx_config_path: nginxPath,
      last_health: {
        ok: health.ok,
        status: health.status,
        body: health.body,
        error: health.error,
        ms: health.ms,
        at: new Date().toISOString(),
        url,
        deployMode: 'php_builtin',
        degraded: true,
        nginxStatus: live.nginxStatus,
        nginxReloaded: live.nginxReloaded,
      },
      last_deploy_at: new Date().toISOString() });

    this.audit?.append({
      actor: opts.actor,
      action: 'project.deploy_php',
      resource: projectId,
      detail: { port, pid, health, listening, deployMode: 'php_builtin' },
      ok: health.ok && listening });

    return {
      ok: health.ok && listening,
      projectId,
      port,
      pid,
      pidfile,
      url,
      processStatus,
      health: {
        ok: health.ok,
        status: health.status,
        body: health.body,
        ms: health.ms,
        error: health.error },
      listening,
      nginxPath,
      notes,
      written,
      degraded: true,
      deployMode: 'pidfile',
      requiresRoot: !this.host.isRoot(),
      requiresExecute: !this.host.executeEnabled() };
  }

  /**
   * Set systemd resource limits stored for next deploy (+ optional live set-property via applyOsLimits).
   */
  setResources(
    projectId: string,
    resources: {
      memoryMax?: string;
      cpuQuotaPercent?: number;
      tasksMax?: number;
      limitNofile?: number;
    },
    actor: string,
  ): OpsApplyResult {
    const row = this.require(projectId);
    if (resources.memoryMax != null && !/^\d+[KMG]?$/i.test(resources.memoryMax)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0328'), {
        httpStatus: 400 });
    }
    if (
      resources.cpuQuotaPercent != null &&
      (!Number.isFinite(resources.cpuQuotaPercent) ||
        resources.cpuQuotaPercent < 1 ||
        resources.cpuQuotaPercent > 10000)
    ) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0087'), { httpStatus: 400 });
    }
    if (
      resources.tasksMax != null &&
      (!Number.isFinite(resources.tasksMax) ||
        resources.tasksMax < 1 ||
        resources.tasksMax > 1_000_000)
    ) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0196'), { httpStatus: 400 });
    }
    if (
      resources.limitNofile != null &&
      (!Number.isFinite(resources.limitNofile) ||
        resources.limitNofile < 64 ||
        resources.limitNofile > 10_000_000)
    ) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0129'), {
        httpStatus: 400 });
    }
    this.projects.updateRuntimeState(projectId, {
      memory_max: resources.memoryMax,
      cpu_quota_percent: resources.cpuQuotaPercent,
      tasks_max: resources.tasksMax,
      limit_nofile: resources.limitNofile });
    this.audit?.append({
      actor,
      action: 'project.set_resources',
      resource: projectId,
      detail: resources,
      ok: true });
    return {
      ok: true,
      projectId,
      processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
      listening: false,
      notes: [
        `memoryMax=${resources.memoryMax ?? row.memory_max ?? 'unset'}`,
        `cpuQuota=${resources.cpuQuotaPercent ?? row.cpu_quota_percent ?? 'unset'}%`,
        `tasksMax=${resources.tasksMax ?? row.tasks_max ?? 'unset'}`,
        `limitNofile=${resources.limitNofile ?? row.limit_nofile ?? 'unset'}`,
        tl('notes.auto.n0763'),
      ],
      written: [] };
  }

  /**
   * Set soft disk quota (MiB); hard setquota runs on applyOsLimits when available.
   */
  async setQuota(
    projectId: string,
    quotaMb: number,
    actor: string,
  ): Promise<OpsApplyResult & { quota?: Awaited<ReturnType<typeof checkProjectQuota>> }> {
    assertQuotaMb(quotaMb);
    const row = this.require(projectId);
    this.projects.updateRuntimeState(projectId, { quota_mb: quotaMb });
    const quota = await checkProjectQuota({
      host: this.host,
      projectId,
      homeDir: row.home_dir,
      quotaMb });
    this.audit?.append({
      actor,
      action: 'project.set_quota',
      resource: projectId,
      detail: quota,
      ok: true });
    return {
      ok: true,
      projectId,
      processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
      listening: false,
      notes: [
        `quota=${quotaMb}MB`,
        `used=${quota.usedMb}MB`,
        ...quota.notes,
        tl('notes.auto.n1463'),
      ],
      written: [],
      quota };
  }

  async getOsUser(projectId: string): Promise<{
    live: OsUserLive;
    limits: {
      quotaMb?: number;
      memoryMax?: string;
      cpuQuotaPercent?: number;
      tasksMax?: number;
      limitNofile?: number;
      shell?: string;
      accountLocked?: boolean;
    };
  }> {
    const row = this.require(projectId);
    const live = await probeOsUser(this.host, row);
    return {
      live,
      limits: {
        quotaMb: row.quota_mb,
        memoryMax: row.memory_max,
        cpuQuotaPercent: row.cpu_quota_percent,
        tasksMax: row.tasks_max,
        limitNofile: row.limit_nofile,
        shell: row.shell ?? '/usr/sbin/nologin',
        accountLocked: row.account_locked } };
  }

  /**
   * Patch shell / lock + resource fields then apply to OS (best-effort).
   */
  async patchOsUser(
    projectId: string,
    patch: {
      shell?: string;
      accountLocked?: boolean;
      memoryMax?: string;
      cpuQuotaPercent?: number;
      tasksMax?: number;
      limitNofile?: number;
      quotaMb?: number;
    },
    actor: string,
  ): Promise<ApplyOsLimitsResult & { projectId: string }> {
    this.require(projectId);
    if (patch.shell != null) {
      const s = patch.shell.trim();
      if (!s.startsWith('/') || s.includes('..') || s.length > 128) {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0432'), { httpStatus: 400 });
      }
    }
    if (patch.quotaMb != null) assertQuotaMb(patch.quotaMb);
    this.projects.updateRuntimeState(projectId, {
      shell: patch.shell?.trim(),
      account_locked: patch.accountLocked,
      memory_max: patch.memoryMax,
      cpu_quota_percent: patch.cpuQuotaPercent,
      tasks_max: patch.tasksMax,
      limit_nofile: patch.limitNofile,
      quota_mb: patch.quotaMb });
    const fresh = this.require(projectId);
    const result = await applyOsUserLimits({
      host: this.host,
      row: fresh,
      dataDir: this.dataDir });
    this.audit?.append({
      actor,
      action: 'project.os_user_patch',
      resource: projectId,
      detail: { patch, result },
      ok: result.ok });
    return { ...result, projectId };
  }

  async applyOsLimits(projectId: string, actor: string): Promise<ApplyOsLimitsResult & { projectId: string }> {
    const row = this.require(projectId);
    const result = await applyOsUserLimits({
      host: this.host,
      row,
      dataDir: this.dataDir });
    this.audit?.append({
      actor,
      action: 'project.os_user_apply_limits',
      resource: projectId,
      detail: result,
      ok: result.ok });
    return { ...result, projectId };
  }

  async chownOsHome(
    projectId: string,
    actor: string,
  ): Promise<{ ok: boolean; notes: string[]; projectId: string }> {
    const row = this.require(projectId);
    const r = await chownHomeNow(this.host, row);
    this.audit?.append({
      actor,
      action: 'project.os_user_chown',
      resource: projectId,
      detail: r,
      ok: r.ok });
    return { ...r, projectId };
  }

  async quotaStatus(projectId: string) {
    const row = this.require(projectId);
    return checkProjectQuota({
      host: this.host,
      projectId,
      homeDir: row.home_dir,
      quotaMb: row.quota_mb });
  }

  private require(id: string): ProjectRow {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.project.notFound', { id }), { httpStatus: 404 });
    }
    return row;
  }

  /** Multi-CDN real client IP opts for nginx renderers. */
  private nginxRealIpOpts(row: ProjectRow): {
    cloudflareRealIp: true;
    realIpProvider: RealIpProviderId | 'inherit';
    realIpHost: ReturnType<typeof loadRealIpConfig>;
  } {
    return {
      cloudflareRealIp: true,
      realIpProvider: (row.real_ip_provider || 'inherit') as RealIpProviderId | 'inherit',
      realIpHost: loadRealIpConfig(this.dataDir),
    };
  }

  private async stopProcess(row: ProjectRow, notes: string[]): Promise<void> {
    const pidfile = row.pidfile ?? join(row.home_dir, 'app.pid');
    let pid = row.pid;
    if (!pid && existsSync(pidfile)) {
      const raw = readFileSync(pidfile, 'utf8').trim();
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) pid = n;
    }
    if (pid && isPidAlive(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
        notes.push(tl('notes.auto.t0200', { v0: (pid) }));
        await waitUntilDead(pid, 3000);
        if (isPidAlive(pid)) {
          process.kill(pid, 'SIGKILL');
          notes.push(tl('notes.auto.t0201', { v0: (pid) }));
        }
      } catch (e) {
        notes.push(`kill ${pid}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (pid) {
      notes.push(tl('notes.auto.t0202', { v0: (pid) }));
    }
    if (existsSync(pidfile)) {
      try {
        unlinkSync(pidfile);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Deploy process-style runtimes: python / go / rust
   * (Node keeps deployNode for PM2/systemd richness.)
   * Build optional → write unit → pidfile spawn → health check → nginx proxy conf.
   */
  async deployProcess(
    projectId: string,
    opts: {
      actor: string;
      entry?: string;
      port?: number;
      skipBuild?: boolean;
      healthTimeoutMs?: number;
    },
  ): Promise<OpsApplyResult> {
    const row = this.require(projectId);
    if (!isProcessRuntime(row.runtime) || row.runtime === 'node') {
      if (row.runtime === 'node') {
        return this.deployNode(projectId, { actor: opts.actor, entry: opts.entry, port: opts.port });
      }
      throw new YskError(
        ErrorCodes.VALIDATION,
        tl('notes.auto.t0203', { v0: (row.runtime) }),
        { httpStatus: 400 },
      );
    }

    assertOsIsolationForDeploy(row, this.host, 'Deploy');
    await assertWithinQuota({
      host: this.host,
      projectId,
      homeDir: row.home_dir,
      quotaMb: row.quota_mb,
      action: 'Deploy' });

    const notes: string[] = [];
    const written: string[] = [];
    if (!canRunAsProjectUser(row, this.host)) {
      notes.push(
        tl('notes.auto.n1534'),
      );
    } else {
      notes.push(tl('notes.auto.t0204', { v0: (row.linux_user) }));
    }
    const appDir = join(row.home_dir, 'app');
    mkdirSync(appDir, { recursive: true });
    mkdirSync(join(row.home_dir, 'logs'), { recursive: true });

    const port = await resolveProcessPort({
      requested: opts.port,
      preferred: row.preferred_port,
      current: row.port,
      from: 3200,
      to: 3999,
    });
    const cargoName = resolveCargoPackageName(appDir);
    // entry: request → saved deploy_entry → auto-detect per runtime
    let entry = opts.entry?.trim() || row.deploy_entry?.trim() || undefined;
    if (!entry && row.runtime === 'python') {
      entry = detectPythonEntry(appDir) ?? undefined;
    }
    if (!entry && row.runtime === 'rust' && cargoName) {
      entry = `./target/release/${cargoName}`;
    }
    if (!entry && (row.runtime === 'java' || row.runtime === 'kotlin')) {
      entry = detectJavaEntry(appDir) ?? undefined;
    }
    if (!entry && row.runtime === 'bun') {
      entry = detectBunEntry(appDir) ?? undefined;
    }
    const cmds = defaultProcessCommands(row.runtime, {
      version: row.runtime_version,
      entry,
      port,
      cargoName: cargoName ?? undefined });
    notes.push(tl('notes.auto.t0205', { v0: (row.runtime), v1: (port), v2: (cmds.entry) }));

    await this.stopProcess(row, notes);

    if (cmds.build && !opts.skipBuild) {
      notes.push(tl('notes.auto.t0206', { v0: (cmds.build) }));
      const build = await runAsProjectUser(this.host, row, cmds.build, {
        timeoutMs: 600_000,
        cwd: appDir,
        notes });
      if (build.exitCode !== 0) {
        const detail =
          (build.stderr || build.stdout || '').trim().slice(0, 600) ||
          `(no stdout/stderr; exit=${build.exitCode})`;
        notes.push(tl('notes.auto.t0207', { v0: detail }));
        this.projects.updateRuntimeState(projectId, {
          process_status: 'failed',
          status: 'failed',
          port,
          last_deploy_notes: clipDeployNotes(notes),
        });
        return {
          ok: false,
          projectId,
          port,
          processStatus: 'failed',
          listening: false,
          notes,
          written,
          degraded: true,
          requiresRoot: !this.host.isRoot(),
          requiresExecute: !this.host.executeEnabled() };
      }
      notes.push(tl('notes.auto.n0821'));
      await chownProjectHome(this.host, row, notes);
    }

    const rtKind = row.runtime as TuningKind;
    const tuningEnv = tuningToEnv(
      loadRuntimeTuning(this.dataDir, rtKind, row.runtime_version ?? 'default'),
    );
    if (Object.keys(tuningEnv).length) {
      notes.push(tl('notes.auto.t0208', { v0: (row.runtime), v1: (Object.keys(tuningEnv).join(', ')) }));
    }
    const processEnv = {
      PORT: String(port),
      HOST: '127.0.0.1',
      ...tuningEnv };

    const unitBody = renderProcessUnit({
      projectName: row.name,
      linuxUser: row.linux_user,
      appDir,
      homeDir: row.home_dir,
      execStart: cmds.execStart,
      port,
      env: processEnv,
      memoryMax: row.memory_max,
      cpuQuotaPercent: row.cpu_quota_percent,
      tasksMax: row.tasks_max,
      limitNOFILE: row.limit_nofile });
    const unitManaged = join(this.dataDir, 'systemd', `ysk-project-${row.linux_user}.service`);
    mkdirSync(join(this.dataDir, 'systemd'), { recursive: true });
    writeFileSync(unitManaged, unitBody, 'utf8');
    written.push(unitManaged);
    notes.push(tl('notes.auto.t0209', { v0: (unitManaged) }));

    let unitActive = false;
    const processUnitName = `ysk-project-${row.linux_user}.service`;
    const pidfile = join(row.home_dir, 'app.pid');
    let pid: number | undefined;
    if (this.host.executeEnabled() && this.host.isRoot() && row.os_provisioned) {
      const systemUnit = `/etc/systemd/system/${processUnitName}`;
      try {
        writeFileSync(systemUnit, unitBody, 'utf8');
        written.push(systemUnit);
        await this.host.runCommand(['systemctl', 'daemon-reload'], { timeoutMs: 15_000 });
        const en = await this.host.runCommand(
          ['systemctl', 'enable', '--now', processUnitName],
          { timeoutMs: 30_000 },
        );
        if (en.exitCode === 0) {
          const health = await assertSystemdUnitHealthy(this.host, processUnitName);
          notes.push(...health.notes);
          if (health.ok) {
            notes.push(tl('notes.auto.t0210', { v0: (row.linux_user) }));
            unitActive = true;
            if (health.mainPid) {
              pid = health.mainPid;
              writeFileSync(pidfile, `${pid}\n`, 'utf8');
            }
          } else {
            notes.push(tl('notes.auto.t0211', { v0: health.detail || 'unit not healthy' }));
            await this.host.runCommand(['systemctl', 'stop', processUnitName], {
              timeoutMs: 15_000,
            });
            await this.host.runCommand(['systemctl', 'reset-failed', processUnitName], {
              timeoutMs: 10_000,
            });
          }
        } else notes.push(tl('notes.auto.t0211', { v0: (en.stderr || en.stdout) }));
      } catch (e) {
        notes.push(tl('notes.auto.t0212', { v0: (e instanceof Error ? e.message : String(e)) }));
      }
    } else {
      notes.push(tl('notes.auto.n0949'));
    }
    if (!unitActive) {
      const active = await this.host.runCommand(
        ['systemctl', 'is-active', processUnitName],
        { timeoutMs: 5_000 },
      );
      unitActive = active.stdout.trim() === 'active';
    }

    if (!unitActive) {
      const logOut = join(row.home_dir, 'logs', 'app.out.log');
      const logErr = join(row.home_dir, 'logs', 'app.err.log');
      try {
        const outFd = openSync(logOut, 'a');
        const errFd = openSync(logErr, 'a');
        const { child } = spawnAsProjectUser({
          row,
          host: this.host,
          shellCmd: cmds.execStart,
          cwd: appDir,
          env: {
            ...process.env,
            ...processEnv },
          logOutFd: outFd,
          logErrFd: errFd,
          notes });
        closeSync(outFd);
        closeSync(errFd);
        pid = child.pid;
        if (pid) {
          child.unref();
          writeFileSync(pidfile, `${pid}\n`, 'utf8');
          notes.push(
            tl('notes.tpl.pidStarted', {
              pid,
              extra: row.linux_user
                ? tl('notes.tpl.pidUser', { user: row.linux_user })
                : tl('notes.tpl.pidDegraded'),
            }),
          );
        } else {
          notes.push(tl('notes.auto.n0378'));
        }
      } catch (err) {
        notes.push(tl('notes.auto.t0214', { v0: (err instanceof Error ? err.message : String(err)) }));
      }
    }
    await chownProjectHome(this.host, row, notes);

    const url = `http://127.0.0.1:${port}/`;
    const health = await waitHttpOk(url, { timeoutMs: opts.healthTimeoutMs ?? 15_000 });
    const listening = await isPortListening(port);
    let processStatus: OpsProcessStatus = 'running';
    if (!health.ok || !listening) {
      processStatus = listening ? 'unhealthy' : 'failed';
      notes.push(
        health.ok
          ? tl('notes.auto.n0633')
          : tl('notes.auto.t0215', { v0: (health.ms), v1: (health.error ?? health.status) }),
      );
    } else {
      notes.push(tl('notes.auto.t0216', { v0: (health.ms) }));
    }

    const serverName = buildServerNameList(
      row.domain ?? `${row.linux_user}.local`,
      row.domain_aliases,
    );
    const conf = renderNginxProxy({
      serverName,
      upstream: `http://127.0.0.1:${port}`,
      ssl: false,
      ...this.nginxRealIpOpts(row),
      forceHttps: false,
      hsts: false,
      siteRedirectUrl: row.site_redirect_url,
      bindIp: row.bind_ip });
    const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
    written.push(nginxPath);
    notes.push(tl('notes.auto.t0217', { v0: (nginxPath) }));
    const live = await this.syncNginxLive(notes, written);

    this.projects.updateRuntimeState(projectId, {
      port,
      pid,
      pidfile,
      process_status: processStatus,
      status: processStatus === 'running' ? 'running' : processStatus,
      last_health: {
        ok: health.ok,
        status: health.status,
        ms: health.ms,
        at: new Date().toISOString(),
        nginxStatus: live.nginxStatus,
        nginxReloaded: live.nginxReloaded,
      },
      last_deploy_at: new Date().toISOString(),
      nginx_config_path: nginxPath,
      deploy_entry: cmds.entry,
      last_deploy_notes: clipDeployNotes(notes) });

    this.audit?.append({
      actor: opts.actor,
      action: 'project.deploy_process',
      resource: projectId,
      detail: { runtime: row.runtime, port, processStatus, entry: cmds.entry, ...live },
      ok: processStatus === 'running' });

    return {
      ok: processStatus === 'running',
      projectId,
      port,
      pid,
      pidfile,
      processStatus,
      listening,
      url,
      notes,
      written,
      deployMode: unitActive ? 'systemd' : 'pidfile',
      nginxReloaded: live.nginxReloaded,
      nginxStatus: live.nginxStatus,
      requiresRoot: !this.host.isRoot(),
      requiresExecute: !this.host.executeEnabled() };
  }
}

/**
 * Whether systemd unit is actually running after enable --now.
 * enable exit 0 alone is insufficient (203/EXEC dies immediately).
 */
export async function assertSystemdUnitHealthy(
  host: HostExecutor,
  unitName: string,
): Promise<{
  ok: boolean;
  active: string;
  result: string;
  mainPid?: number;
  notes: string[];
  detail: string;
}> {
  const notes: string[] = [];
  const act = await host.runCommand(['systemctl', 'is-active', unitName], { timeoutMs: 5_000 });
  const active = (act.stdout || '').trim();
  const mainPidR = await host.runCommand(
    ['systemctl', 'show', '-p', 'MainPID', '--value', unitName],
    { timeoutMs: 5_000 },
  );
  const resultR = await host.runCommand(
    ['systemctl', 'show', '-p', 'Result', '--value', unitName],
    { timeoutMs: 5_000 },
  );
  const unitResult = (resultR.stdout || '').trim();
  const n = Number((mainPidR.stdout || '').trim());
  const mainPid = Number.isFinite(n) && n > 0 ? n : undefined;
  const detail = `is-active=${active || '?'}, Result=${unitResult || '?'}, MainPID=${mainPid ?? 0}`;
  notes.push(`systemd: ${detail}`);
  // Type=simple: active + MainPID>0 is the real success signal
  const ok = active === 'active' && mainPid != null;
  if (!ok) {
    notes.push(tl('notes.deploy.unitUnhealthy', { detail, unit: unitName }));
  }
  return { ok, active, result: unitResult, mainPid, notes, detail };
}

function nodeBinaryExists(
  path: string,
  host?: Pick<HostExecutor, 'pathExists'>,
): boolean {
  if (!path || path === 'node') return true; // PATH name — cannot prove here
  if (host?.pathExists?.(path)) return true;
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Stop + disable project systemd unit so PM2 (or a new unit start) can bind the port.
 * Idempotent; safe when unit missing.
 */
export async function stopAndDisableProjectUnit(
  host: HostExecutor,
  unitName: string,
): Promise<string[]> {
  const notes: string[] = [];
  if (!host.executeEnabled() || !host.isRoot()) {
    notes.push(`skip stop/disable ${unitName} (need root+execute)`);
    return notes;
  }
  const stop = await host.runCommand(['systemctl', 'stop', unitName], { timeoutMs: 20_000 });
  notes.push(`systemctl stop ${unitName} exit=${stop.exitCode}`);
  const dis = await host.runCommand(['systemctl', 'disable', unitName], { timeoutMs: 15_000 });
  notes.push(`systemctl disable ${unitName} exit=${dis.exitCode}`);
  await host.runCommand(['systemctl', 'reset-failed', unitName], { timeoutMs: 10_000 });
  return notes;
}

/**
 * True if a project linux user (ysks_*) can exec this path.
 * Rejects root-private and per-user toolchains (hermes/nvm/cargo under /root).
 */
export function isProjectUserExecutablePath(bin: string): boolean {
  const p = String(bin || '').trim();
  if (!p) return false;
  // bare names resolve via unit PATH
  if (!p.startsWith('/')) return true;
  if (p.startsWith('/root/')) return false;
  if (p.includes('/.hermes/')) return false;
  // Private toolchains under a home dir are not shared with project users
  if (/\/\.(nvm|fnm|local\/share\/fnm|volta|cargo)\//.test(p)) return false;
  if (/\/go\/bin\//.test(p) && (p.includes('/root/') || p.includes('/home/'))) {
    // allow only if under project home would need more context — block generic home go/bin
    if (!p.includes('/ysk-server') && !p.includes('/usr/local/ysk')) return false;
  }
  return true;
}

/** @deprecated use isProjectUserExecutablePath */
export function isProjectUserExecutableNodePath(bin: string): boolean {
  return isProjectUserExecutablePath(bin);
}

export type ResolveNodeBinaryResult = { path: string; notes: string[] };

/**
 * Resolve Node binary for project deploy (systemd User=ysks_*).
 * Prefer /usr/local/ysk/node/<major>/bin/node (toolchain install layout).
 * Never put panel process.execPath under /root into systemd (203/EXEC).
 *
 * Degraded deploys (no root / no execute) may use panel nvm/hermes path because
 * the process runs as the panel user, not ysks_*.
 */
export function resolveNodeBinary(
  version?: string,
  host?: Pick<HostExecutor, 'pathExists' | 'isRoot' | 'executeEnabled'>,
): ResolveNodeBinaryResult {
  const notes: string[] = [];
  const plan = selectNodeRuntime(version || defaultRuntimeVersion('node'));
  const major = plan.version;
  const planned = plan.binaryPath;
  // Root+execute → unit runs as project user; private panel Node is forbidden
  const isolatedTarget = Boolean(host?.executeEnabled() && host?.isRoot());

  const candidates: string[] = [
    planned,
    `/usr/local/ysk/node/${major}/bin/node`,
    `/usr/bin/node${major}`,
    '/usr/local/bin/node',
    '/usr/bin/node',
  ];

  const exists = (p: string): boolean => {
    if (host?.pathExists?.(p)) return true;
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  };

  for (const c of candidates) {
    if (!isProjectUserExecutablePath(c)) continue;
    if (exists(c)) {
      // Prefer planned major path; only accept system node if major matches or ysk path missing
      if (c === planned || c.includes(`/ysk/node/${major}/`)) {
        if (c !== planned) {
          notes.push(tl('notes.deploy.usingFallback', { path: c, planned }));
        }
        return { path: c, notes };
      }
      // /usr/bin/node — only if no ysk major path; note version may skew
      if (c === '/usr/bin/node' || c === '/usr/local/bin/node' || c === `/usr/bin/node${major}`) {
        notes.push(tl('notes.deploy.usingFallback', { path: c, planned }));
        return { path: c, notes };
      }
    }
  }

  if (process.execPath && exists(process.execPath)) {
    if (isProjectUserExecutablePath(process.execPath)) {
      notes.push(tl('notes.deploy.usingPanelExec', { path: process.execPath }));
      return { path: process.execPath, notes };
    }
    if (!isolatedTarget) {
      // Dev / non-root panel: same-user pidfile can use nvm/hermes path
      notes.push(tl('notes.deploy.usingPanelDegraded', { path: process.execPath }));
      return { path: process.execPath, notes };
    }
    notes.push(tl('notes.deploy.skippedPanelNode', { path: process.execPath }));
  }

  notes.push(tl('notes.deploy.nodeNotFoundPlanned', { version: major, planned }));
  return { path: planned, notes };
}

/** String path helper for callers that only need the path. */
export function resolveNodeBinaryPath(
  version?: string,
  host?: Pick<HostExecutor, 'pathExists' | 'isRoot' | 'executeEnabled'>,
): string {
  return resolveNodeBinary(version, host).path;
}

function clipDeployNotes(notes: string[]): string[] {
  return notes.filter(Boolean).slice(-8);
}

/**
 * Prefer Django wsgi, then FastAPI main:app, then app.py / main.py script.
 */
export function detectPythonEntry(appDir: string): string | null {
  // Django: */wsgi.py under first-level package
  try {
    for (const name of readdirSync(appDir)) {
      const sub = join(appDir, name);
      try {
        if (!statSync(sub).isDirectory()) continue;
      } catch {
        continue;
      }
      if (existsSync(join(sub, 'wsgi.py')) && existsSync(join(sub, 'settings.py'))) {
        return `${name}.wsgi:application`;
      }
    }
  } catch {
    /* fall through */
  }
  if (existsSync(join(appDir, 'main.py'))) return 'main:app';
  if (existsSync(join(appDir, 'app.py'))) return 'app.py';
  return null;
}

/** Read [package] name from Cargo.toml for release binary path. */
export function resolveCargoPackageName(appDir: string): string | null {
  const p = join(appDir, 'Cargo.toml');
  if (!existsSync(p)) return null;
  try {
    const text = readFileSync(p, 'utf8');
    const m = text.match(/^\s*name\s*=\s*"([^"]+)"/m);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

async function resolvePhpBinary(host: HostExecutor, version: string): Promise<string | null> {
  const { resolveBin } = await import('./software-probe/index.js');
  const candidates = [`php${version}`, `php${version.split('.')[0]}`, 'php'];
  for (const bin of candidates) {
    const p = await resolveBin(host, bin);
    if (p) return p;
  }
  return null;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDead(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isPidAlive(pid)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}
