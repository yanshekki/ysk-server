/**
 * Project operations: real Node process deploy (pidfile + listen + HTTP health)
 * and Nginx publish with correct upstream port.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  openSync,
  closeSync,
} from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';
import { checkHttp, findFreePort, isPortListening, waitHttpOk } from '../host/health.js';
import type { ProjectRepository, ProjectRow } from '../repositories/project-repo.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import { applyNodeHosting } from './node-apply.js';
import { renderNginxPhpFpm, renderNginxProxy } from './nginx-ssl.js';
import { syncNginxConfigs, writeManagedNginxConf } from './nginx-sync.js';
import { selectPhpRuntime } from './runtime.js';
import { gitSync } from './git-deploy.js';
import { backupProject } from './backup-cron.js';
import { applyPhpHosting } from './system-apply.js';
import { resolveManagedCertPaths } from './ssl-certs.js';
import { applyPhpFpmPool } from './php-fpm.js';
import { assertQuotaMb, checkProjectQuota } from './quota.js';
import { applyPm2Start, applyPm2Stop, writePm2Ecosystem } from './pm2-apply.js';

export type OpsProcessStatus = 'stopped' | 'starting' | 'running' | 'unhealthy' | 'failed';

export type DeployMode = 'systemd' | 'pm2' | 'pidfile' | 'none';

export interface OpsApplyResult {
  ok: boolean;
  projectId: string;
  port?: number;
  pid?: number;
  pidfile?: string;
  url?: string;
  processStatus: OpsProcessStatus;
  health?: { ok: boolean; status?: number; body?: string; ms?: number; error?: string };
  listening: boolean;
  nginxPath?: string;
  notes: string[];
  written: string[];
  /** true when process was only pidfile-spawned (not system systemd) */
  degraded?: boolean;
  requiresRoot?: boolean;
  requiresExecute?: boolean;
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
      throw new YskError(ErrorCodes.VALIDATION, 'deployNode only supports runtime=node', {
        httpStatus: 400,
      });
    }

    const notes: string[] = [];
    const written: string[] = [];
    const entry = opts.entry ?? 'server.js';
    const nodeBinary = resolveNodeBinary();
    notes.push(`Using node binary: ${nodeBinary}`);

    const port = opts.port ?? row.port ?? (await findFreePort(3100, 3999));
    notes.push(`Target port: ${port}`);

    // Stop any previous process for this project
    await this.stopProcess(row, notes);

    const preferSystemd =
      opts.enableSystemd === true ||
      (opts.enableSystemd !== false && this.host.executeEnabled() && this.host.isRoot());

    const memoryMax = opts.memoryMax ?? row.memory_max;
    const cpuQuotaPercent = opts.cpuQuotaPercent ?? row.cpu_quota_percent;
    const apply = await applyNodeHosting({
      dataDir: this.dataDir,
      projectId: row.id,
      projectName: row.name,
      linuxUser: row.linux_user,
      homeDir: row.home_dir,
      nodeVersion: opts.nodeVersion ?? row.runtime_version ?? '20',
      entry,
      port,
      host: this.host,
      enableService: preferSystemd,
      nodeBinary,
      memoryMax,
      cpuQuotaPercent,
      limitNOFILE: 65535,
    });
    written.push(apply.envPath, apply.unitPath, apply.appDir);
    notes.push(...apply.notes);

    const appDir = apply.appDir;
    const entryPath = join(appDir, entry);
    if (!existsSync(entryPath)) {
      throw new YskError(ErrorCodes.INTERNAL, `Entry missing after apply: ${entryPath}`, {
        httpStatus: 500,
      });
    }

    mkdirSync(join(row.home_dir, 'logs'), { recursive: true });
    const pidfile = join(row.home_dir, 'app.pid');
    const unitName = `ysk-project-${row.linux_user}.service`;

    this.projects.updateRuntimeState(projectId, {
      port,
      pid: undefined,
      pidfile,
      process_status: 'starting',
      status: 'deploying',
      last_health: undefined,
      last_deploy_at: new Date().toISOString(),
    });

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
    });
    written.push(eco.ecosystemPath);
    notes.push(...eco.notes);
    pm2App = eco.appName;

    if (preferSystemd && this.host.executeEnabled() && this.host.isRoot()) {
      // Production path: install unit and start via systemd
      const r1 = await this.host.runCommand(['cp', apply.unitPath, `/etc/systemd/system/${unitName}`]);
      const r2 = await this.host.runCommand(['systemctl', 'daemon-reload']);
      const r3 = await this.host.runCommand(['systemctl', 'enable', '--now', unitName]);
      notes.push(
        `systemd: cp exit=${r1.exitCode}, daemon-reload=${r2.exitCode}, enable=${r3.exitCode}`,
      );
      if (r1.exitCode === 0 && r3.exitCode === 0) {
        deployMode = 'systemd';
        degraded = false;
        const mainPid = await this.host.runCommand([
          'systemctl',
          'show',
          '-p',
          'MainPID',
          '--value',
          unitName,
        ]);
        const n = Number(mainPid.stdout.trim());
        if (Number.isFinite(n) && n > 0) {
          pid = n;
          writeFileSync(pidfile, `${pid}\n`, 'utf8');
        }
        notes.push(`Production deploy via systemd unit ${unitName}`);
      } else {
        notes.push('systemd enable failed — trying PM2 / pidfile fallback');
      }
    }

    // PM2 path after systemd miss: needs YSK_EXECUTE + pm2 on PATH (never fake ok).
    const tryPm2 =
      deployMode !== 'systemd' && opts.preferPm2 !== false && this.host.executeEnabled();

    if (tryPm2) {
      const pm2 = await applyPm2Start({
        host: this.host,
        homeDir: row.home_dir,
        linuxUser: row.linux_user,
        appDir,
        entry,
        port,
        nodeBinary,
        execute: true,
      });
      notes.push(...pm2.notes);
      if (pm2.ok) {
        deployMode = 'pm2';
        degraded = false;
        pid = pm2.pid;
        if (pid) writeFileSync(pidfile, `${pid}\n`, 'utf8');
        notes.push(`Deploy via PM2 app ${pm2.appName}`);
      } else if (!this.host.executeEnabled()) {
        notes.push('PM2 start refused without YSK_EXECUTE — falling back to pidfile');
      } else {
        notes.push('PM2 start failed — falling back to pidfile spawn');
      }
    }

    if (deployMode === 'pidfile') {
      notes.push(
        'Deploy mode: pidfile (degraded). Root+YSK_EXECUTE → systemd; non-root+YSK_EXECUTE+pm2 → PM2.',
      );
    }

    if (deployMode === 'pidfile') {
      const logOut = join(row.home_dir, 'logs', 'app.out.log');
      const logErr = join(row.home_dir, 'logs', 'app.err.log');
      let child: ChildProcess;
      try {
        const outFd = openSync(logOut, 'a');
        const errFd = openSync(logErr, 'a');
        child = spawn(nodeBinary, [entry], {
          cwd: appDir,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            PORT: String(port),
            HOST: '127.0.0.1',
          },
          detached: true,
          stdio: ['ignore', outFd, errFd],
        });
        closeSync(outFd);
        closeSync(errFd);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.projects.updateRuntimeState(projectId, {
          process_status: 'failed',
          status: 'failed',
          last_health: { ok: false, error: msg, at: new Date().toISOString() },
        });
        return {
          ok: false,
          projectId,
          port,
          pidfile,
          processStatus: 'failed',
          listening: false,
          notes: [...notes, `spawn failed: ${msg}`],
          written,
          degraded: true,
          deployMode: 'pidfile',
          requiresRoot: !this.host.isRoot(),
          requiresExecute: !this.host.executeEnabled(),
        };
      }

      pid = child.pid;
      if (!pid) {
        this.projects.updateRuntimeState(projectId, {
          process_status: 'failed',
          status: 'failed',
        });
        return {
          ok: false,
          projectId,
          port,
          pidfile,
          processStatus: 'failed',
          listening: false,
          notes: [...notes, 'spawn returned no pid'],
          written,
          degraded: true,
          deployMode: 'pidfile',
        };
      }
      child.unref();
      writeFileSync(pidfile, `${pid}\n`, 'utf8');
      notes.push(`Spawned pid=${pid}, pidfile=${pidfile}`);
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
    const serverName = row.domain ?? `${row.linux_user}.local`;
    const conf = renderNginxProxy({
      serverName,
      upstream: `http://127.0.0.1:${port}`,
      ssl: false,
      cloudflareRealIp: true,
    });
    const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
    written.push(nginxPath);
    notes.push(`Nginx conf published (managed): ${nginxPath}`);

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
      },
      last_deploy_at: new Date().toISOString(),
    });

    this.audit?.append({
      actor: opts.actor,
      action: 'project.deploy_node',
      resource: projectId,
      detail: { port, pid, health, listening, nginxPath, deployMode, degraded },
      ok: health.ok && listening,
    });

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
        error: health.error,
      },
      listening,
      nginxPath,
      notes,
      written,
      degraded,
      deployMode,
      systemdUnit: deployMode === 'systemd' ? unitName : undefined,
      pm2App: deployMode === 'pm2' ? pm2App : undefined,
      requiresRoot: !this.host.isRoot(),
      requiresExecute: !this.host.executeEnabled(),
    };
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
      last_health: { ok: false, error: 'stopped', at: new Date().toISOString() },
    });
    this.audit?.append({
      actor,
      action: 'project.stop_node',
      resource: projectId,
      detail: { notes },
      ok: true,
    });
    return {
      ok: true,
      projectId,
      port: row.port,
      processStatus: 'stopped',
      listening: false,
      notes,
      written: [],
    };
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
        notes: ['No port assigned — deploy first'],
        written: [],
      };
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
        url,
      },
    });

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
        error: health.error,
      },
      listening,
      nginxPath: row.nginx_config_path,
      notes: [
        listening ? `Port ${port} is listening` : `Port ${port} is not listening`,
        health.ok ? `HTTP OK ${health.status}` : `HTTP fail: ${health.error ?? health.status}`,
      ],
      written: [],
    };
  }

  /**
   * Write/update nginx conf for project and optionally sync to system conf.d.
   */
  async publishNginx(
    projectId: string,
    opts: {
      actor: string;
      systemConfDir?: string;
      ssl?: boolean;
      /** When true (default if EXECUTE), run nginx -t + reload */
      reload?: boolean;
    },
  ): Promise<OpsApplyResult> {
    const row = this.require(projectId);
    const port = row.port ?? 3000;
    const serverName = row.domain ?? `${row.linux_user}.local`;
    const wantSsl = opts.ssl ?? false;
    const managed = resolveManagedCertPaths(this.dataDir, serverName);
    const conf = renderNginxProxy({
      serverName,
      upstream: `http://127.0.0.1:${port}`,
      ssl: wantSsl,
      cloudflareRealIp: true,
      sslCertificate: wantSsl && managed.exists ? managed.fullchain : undefined,
      sslCertificateKey: wantSsl && managed.exists ? managed.privkey : undefined,
    });
    const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
    const systemDir =
      opts.systemConfDir ??
      (this.host.executeEnabled() && this.host.isRoot() ? '/etc/nginx/conf.d' : undefined);
    const sync = await syncNginxConfigs({
      dataDir: this.dataDir,
      systemConfDir: systemDir,
      host: this.host,
    });
    const notes = [`Wrote ${nginxPath}`, ...sync.notes];
    if (wantSsl && managed.exists) {
      notes.push(`Using uploaded certs: ${managed.fullchain}`);
    } else if (wantSsl) {
      notes.push(
        `SSL enabled with default LE paths (or upload via POST /api/v1/ssl/upload for ${serverName})`,
      );
    }
    let nginxReloaded = false;
    let nginxStatus = 'managed_only';
    const wantReload = opts.reload ?? Boolean(systemDir && this.host.executeEnabled());

    if (wantReload && this.host.executeEnabled()) {
      const t = await this.host.runCommand(['nginx', '-t'], { timeoutMs: 10_000 });
      notes.push(`nginx -t exit=${t.exitCode}: ${(t.stderr || t.stdout).trim()}`);
      if (t.exitCode === 0) {
        const r = await this.host.runCommand(['systemctl', 'reload', 'nginx'], { timeoutMs: 15_000 });
        nginxReloaded = r.exitCode === 0;
        nginxStatus = nginxReloaded ? 'reloaded' : `reload_failed:${r.stderr}`;
        notes.push(nginxReloaded ? 'nginx reloaded' : `nginx reload failed: ${r.stderr}`);
      } else {
        nginxStatus = 'nginx_t_failed';
      }
    } else if (wantReload) {
      notes.push('nginx reload skipped: set YSK_EXECUTE=1');
      nginxStatus = 'requires_execute';
    }

    this.projects.updateRuntimeState(projectId, {
      nginx_config_path: nginxPath,
      last_health: {
        ...(row.last_health ?? {}),
        nginxStatus,
        nginxReloaded,
        at: new Date().toISOString(),
      },
    });
    this.projects.updateNginxPath(projectId, nginxPath);
    this.audit?.append({
      actor: opts.actor,
      action: 'project.publish_nginx',
      resource: projectId,
      detail: { nginxPath, port, sync, nginxReloaded, nginxStatus },
      ok: true,
    });
    return {
      ok: true,
      projectId,
      port,
      processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
      listening: port ? await isPortListening(port) : false,
      nginxPath,
      notes,
      written: [nginxPath, ...sync.copied],
      nginxReloaded,
      nginxStatus,
      requiresExecute: !this.host.executeEnabled(),
      requiresRoot: !this.host.isRoot(),
      degraded: !nginxReloaded,
    };
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
      linuxUser: row.linux_user,
    };
  }

  /**
   * Git clone/pull into project app dir, then redeploy runtime if node/php.
   */
  async gitDeploy(
    projectId: string,
    opts: {
      actor: string;
      gitUrl?: string;
      branch?: string;
      redeploy?: boolean;
      depth?: number;
    },
  ): Promise<OpsApplyResult & { git?: Awaited<ReturnType<typeof gitSync>> }> {
    const row = this.require(projectId);
    const gitUrl = opts.gitUrl ?? row.git_url;
    if (!gitUrl) {
      throw new YskError(ErrorCodes.VALIDATION, 'gitUrl required (or set on project)', {
        httpStatus: 400,
      });
    }
    const appDir = join(row.home_dir, 'app');
    const git = await gitSync({
      host: this.host,
      gitUrl,
      targetDir: appDir,
      branch: opts.branch ?? row.git_branch,
      depth: opts.depth ?? 1,
    });
    this.projects.updateRuntimeState(projectId, {
      git_url: gitUrl,
      git_branch: git.branch ?? opts.branch,
      git_commit: git.commit,
    });
    const notes = [...git.notes];
    let redeployResult: OpsApplyResult | undefined;
    if (git.ok && opts.redeploy !== false) {
      if (row.runtime === 'node') {
        redeployResult = await this.deployNode(projectId, { actor: opts.actor });
        notes.push(...redeployResult.notes);
      } else if (row.runtime === 'php') {
        redeployResult = await this.deployPhp(projectId, { actor: opts.actor });
        notes.push(...redeployResult.notes);
      } else {
        notes.push('Runtime static — git sync only, no process redeploy');
      }
    }
    this.audit?.append({
      actor: opts.actor,
      action: 'project.git_deploy',
      resource: projectId,
      detail: { git, redeploy: Boolean(redeployResult) },
      ok: git.ok && (redeployResult?.ok ?? true),
    });
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
      degraded: redeployResult?.degraded ?? true,
    };
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
      ok: true,
    });
    return {
      ok: true,
      projectId,
      processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
      listening: false,
      notes: [`Wrote ${envPath} (${Object.keys(merged).length} keys)`],
      written: [envPath],
    };
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
      homeDir: row.home_dir,
    });
    if (r.ok && r.archivePath) {
      this.projects.updateRuntimeState(projectId, {
        last_backup_path: r.archivePath,
        last_backup_at: new Date().toISOString(),
      });
    }
    this.audit?.append({
      actor,
      action: 'project.backup',
      resource: projectId,
      detail: r,
      ok: r.ok,
    });
    return {
      ok: r.ok,
      projectId,
      processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
      listening: false,
      notes: r.notes,
      written: r.archivePath ? [r.archivePath] : [],
      archivePath: r.archivePath,
    };
  }

  /**
   * PHP deploy dual-mode:
   * - production: PHP-FPM pool + nginx fastcgi when preferFpm/enableFpm + root + YSK_EXECUTE
   * - degraded: `php -S` built-in server (verifiable without root)
   */
  async deployPhp(
    projectId: string,
    opts: {
      actor: string;
      port?: number;
      phpVersion?: string;
      enableApache?: boolean;
      /** Prefer PHP-FPM + nginx (default true when root+EXECUTE) */
      preferFpm?: boolean;
      /** Force php -S even if FPM available */
      forceBuiltin?: boolean;
      healthTimeoutMs?: number;
    },
  ): Promise<OpsApplyResult> {
    const row = this.require(projectId);
    if (row.runtime !== 'php' && row.runtime !== 'static') {
      if (row.runtime === 'node') {
        throw new YskError(ErrorCodes.VALIDATION, 'deployPhp: project runtime is node — use deployNode', {
          httpStatus: 400,
        });
      }
    }
    const notes: string[] = [];
    const written: string[] = [];
    const port = opts.port ?? row.port ?? (await findFreePort(8100, 8999));
    const docRoot = join(row.home_dir, 'app', 'public');
    mkdirSync(docRoot, { recursive: true });
    const domain = row.domain ?? `${row.linux_user}.local`;

    const phpVersion = opts.phpVersion ?? row.runtime_version ?? '8.2';
    const phpRt = selectPhpRuntime(phpVersion);
    const canProd =
      this.host.executeEnabled() &&
      this.host.isRoot() &&
      opts.forceBuiltin !== true &&
      (opts.preferFpm === true ||
        opts.enableApache === true ||
        (opts.preferFpm !== false && opts.enableApache !== false));

    const apply = await applyPhpHosting({
      dataDir: this.dataDir,
      domain,
      docRoot,
      phpVersion,
      poolName: row.linux_user,
      host: this.host,
      enableSite: Boolean(canProd && opts.enableApache),
    });
    written.push(...apply.written);
    notes.push(...apply.notes);

    const fpm = await applyPhpFpmPool({
      dataDir: this.dataDir,
      poolName: row.linux_user,
      linuxUser: row.linux_user,
      phpVersion,
      host: this.host,
      enable: canProd,
    });
    written.push(...fpm.written);
    notes.push(...fpm.notes);

    await this.stopProcess(row, notes);

    // —— Production path: FPM enabled → nginx fastcgi, no php -S ——
    if (fpm.enabled) {
      const fpmSocket =
        `/run/php/php${phpRt.version}-fpm-${row.linux_user}.sock`;
      const conf = renderNginxPhpFpm({
        serverName: domain,
        docRoot,
        fpmSocket,
        ssl: false,
        cloudflareRealIp: true,
      });
      const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
      written.push(nginxPath);
      notes.push(`PHP-FPM production nginx conf: ${nginxPath}`);
      notes.push(`fastcgi_pass unix:${fpmSocket}`);

      // best-effort system sync + nginx -t + reload
      let nginxReloaded = false;
      if (this.host.executeEnabled() && this.host.isRoot()) {
        const sync = await syncNginxConfigs({
          dataDir: this.dataDir,
          systemConfDir: '/etc/nginx/conf.d',
          host: this.host,
          dryRun: false,
        });
        written.push(...sync.copied);
        notes.push(...sync.notes);
        if (sync.tested) {
          const rel = await this.host.runCommand(['systemctl', 'reload', 'nginx'], {
            timeoutMs: 15_000,
          });
          nginxReloaded = rel.exitCode === 0;
          notes.push(
            nginxReloaded
              ? 'nginx reloaded'
              : `nginx reload exit=${rel.exitCode}: ${rel.stderr}`,
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
          deployMode: 'php_fpm',
          degraded: false,
          fpmSocket,
          nginxReloaded,
        },
        last_deploy_at: new Date().toISOString(),
      });

      this.audit?.append({
        actor: opts.actor,
        action: 'project.deploy_php',
        resource: projectId,
        detail: { deployMode: 'php_fpm', fpmSocket, nginxPath, nginxReloaded },
        ok: true,
      });

      return {
        ok: true,
        projectId,
        processStatus: 'running',
        listening: false,
        nginxPath,
        notes: [
          ...notes,
          'Production PHP-FPM path — verify via public hostname after nginx reload',
        ],
        written,
        degraded: false,
        deployMode: 'none',
        nginxReloaded,
      };
    }

    if (canProd && !fpm.enabled) {
      notes.push(
        'PHP-FPM enable requested but not active — falling back to php -S (degraded)',
      );
    } else {
      notes.push(
        'Deploy mode: php -S (degraded). Root+YSK_EXECUTE for PHP-FPM+nginx production path.',
      );
    }

    // —— Degraded path: php -S ——
    const phpBin = await resolvePhpBinary(this.host, phpVersion);
    if (!phpBin) {
      this.projects.updateRuntimeState(projectId, {
        port,
        process_status: 'failed',
        status: 'failed',
      });
      return {
        ok: false,
        projectId,
        port,
        processStatus: 'failed',
        listening: false,
        notes: [...notes, 'php binary not found — install php-cli'],
        written,
        degraded: true,
        deployMode: 'pidfile',
      };
    }

    const pidfile = join(row.home_dir, 'app.pid');
    const logOut = join(row.home_dir, 'logs', 'php.out.log');
    const logErr = join(row.home_dir, 'logs', 'php.err.log');
    mkdirSync(join(row.home_dir, 'logs'), { recursive: true });

    const outFd = openSync(logOut, 'a');
    const errFd = openSync(logErr, 'a');
    const child = spawn(phpBin, ['-S', `127.0.0.1:${port}`, '-t', docRoot], {
      cwd: docRoot,
      env: { ...process.env, PORT: String(port) },
      detached: true,
      stdio: ['ignore', outFd, errFd],
    });
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
        notes: [...notes, 'php spawn returned no pid'],
        written,
        degraded: true,
        deployMode: 'pidfile',
      };
    }
    child.unref();
    writeFileSync(pidfile, `${pid}\n`, 'utf8');
    notes.push(`PHP built-in server pid=${pid} on 127.0.0.1:${port}`);

    const url = `http://127.0.0.1:${port}/`;
    const health = await waitHttpOk(url, { timeoutMs: opts.healthTimeoutMs ?? 12_000 });
    const listening = await isPortListening(port);
    const processStatus: OpsProcessStatus =
      health.ok && listening ? 'running' : 'unhealthy';

    // Proxy nginx for degraded path (local health via php -S)
    const conf = renderNginxProxy({
      serverName: domain,
      upstream: `http://127.0.0.1:${port}`,
      ssl: false,
      cloudflareRealIp: true,
    });
    const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
    written.push(nginxPath);

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
      },
      last_deploy_at: new Date().toISOString(),
    });

    this.audit?.append({
      actor: opts.actor,
      action: 'project.deploy_php',
      resource: projectId,
      detail: { port, pid, health, listening, deployMode: 'php_builtin' },
      ok: health.ok && listening,
    });

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
        error: health.error,
      },
      listening,
      nginxPath,
      notes,
      written,
      degraded: true,
      deployMode: 'pidfile',
      requiresRoot: !this.host.isRoot(),
      requiresExecute: !this.host.executeEnabled(),
    };
  }

  /**
   * Set systemd resource limits (MemoryMax / CPUQuota) stored for next deploy.
   */
  setResources(
    projectId: string,
    resources: { memoryMax?: string; cpuQuotaPercent?: number },
    actor: string,
  ): OpsApplyResult {
    const row = this.require(projectId);
    if (resources.memoryMax != null && !/^\d+[KMG]?$/i.test(resources.memoryMax)) {
      throw new YskError(ErrorCodes.VALIDATION, 'memoryMax must look like 512M or 1G', {
        httpStatus: 400,
      });
    }
    if (
      resources.cpuQuotaPercent != null &&
      (!Number.isFinite(resources.cpuQuotaPercent) ||
        resources.cpuQuotaPercent < 1 ||
        resources.cpuQuotaPercent > 10000)
    ) {
      throw new YskError(ErrorCodes.VALIDATION, 'cpuQuotaPercent 1..10000', { httpStatus: 400 });
    }
    this.projects.updateRuntimeState(projectId, {
      memory_max: resources.memoryMax,
      cpu_quota_percent: resources.cpuQuotaPercent,
    });
    this.audit?.append({
      actor,
      action: 'project.set_resources',
      resource: projectId,
      detail: resources,
      ok: true,
    });
    return {
      ok: true,
      projectId,
      processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
      listening: false,
      notes: [
        `memoryMax=${resources.memoryMax ?? row.memory_max ?? 'unset'}`,
        `cpuQuota=${resources.cpuQuotaPercent ?? row.cpu_quota_percent ?? 'unset'}%`,
        'Re-deploy Node to rewrite systemd unit with limits',
      ],
      written: [],
    };
  }

  /**
   * Set soft disk quota (MiB) and return current usage.
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
      quotaMb,
    });
    this.audit?.append({
      actor,
      action: 'project.set_quota',
      resource: projectId,
      detail: quota,
      ok: true,
    });
    return {
      ok: true,
      projectId,
      processStatus: (row.process_status as OpsProcessStatus) ?? 'stopped',
      listening: false,
      notes: [`quota=${quotaMb}MB`, `used=${quota.usedMb}MB`, ...quota.notes],
      written: [],
      quota,
    };
  }

  async quotaStatus(projectId: string) {
    const row = this.require(projectId);
    return checkProjectQuota({
      host: this.host,
      projectId,
      homeDir: row.home_dir,
      quotaMb: row.quota_mb,
    });
  }

  private require(id: string): ProjectRow {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `Project not found: ${id}`, { httpStatus: 404 });
    }
    return row;
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
        notes.push(`Sent SIGTERM to ${pid}`);
        await waitUntilDead(pid, 3000);
        if (isPidAlive(pid)) {
          process.kill(pid, 'SIGKILL');
          notes.push(`Sent SIGKILL to ${pid}`);
        }
      } catch (e) {
        notes.push(`kill ${pid}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (pid) {
      notes.push(`pid ${pid} already dead`);
    }
    if (existsSync(pidfile)) {
      try {
        unlinkSync(pidfile);
      } catch {
        /* ignore */
      }
    }
  }
}

export function resolveNodeBinary(): string {
  // Prefer current process binary so deploy works without custom node install
  if (process.execPath && existsSync(process.execPath)) return process.execPath;
  return 'node';
}

async function resolvePhpBinary(host: HostExecutor, version: string): Promise<string | null> {
  const candidates = [`php${version}`, `php${version.split('.')[0]}`, 'php'];
  for (const bin of candidates) {
    const r = await host.runCommand(['bash', '-c', `command -v ${bin} || true`], { timeoutMs: 3_000 });
    const p = r.stdout.trim();
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
