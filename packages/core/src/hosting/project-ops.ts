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
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError } from '@ysk/shared';
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
  renderNginxSuspended,
} from './nginx-ssl.js';
import { syncNginxConfigs, writeManagedNginxConf } from './nginx-sync.js';
import {
  defaultProcessCommands,
  isProcessRuntime,
  renderProcessUnit,
  selectPhpRuntime,
} from './runtime.js';
import { gitSync } from './git-deploy.js';
import { backupProject } from './backup-cron.js';
import { applyPhpHosting } from './system-apply.js';
import { resolveManagedCertPaths } from './ssl-certs.js';
import { applyPhpFpmPool } from './php-fpm.js';
import { assertQuotaMb, assertWithinQuota, checkProjectQuota } from './quota.js';
import { applyPm2Start, applyPm2Stop, writePm2Ecosystem } from './pm2-apply.js';
import {
  assertOsIsolationForDeploy,
  canRunAsProjectUser,
  chownProjectHome,
  runAsProjectUser,
  shellQuote,
  spawnAsProjectUser,
} from './project-user-run.js';
import {
  applyOsUserLimits,
  chownHomeNow,
  probeOsUser,
  type ApplyOsLimitsResult,
  type OsUserLive,
} from './project-os-user.js';

export type OpsProcessStatus = 'stopped' | 'starting' | 'running' | 'unhealthy' | 'failed';

export type DeployMode = 'systemd' | 'pm2' | 'pidfile' | 'none';

/** Resolve document root: relative doc_root under home, default app/public */
export function resolveProjectDocRoot(row: ProjectRow): string {
  const rel = (row.doc_root ?? 'app/public').replace(/^\/+/, '').replace(/\.\./g, '');
  return join(row.home_dir, rel || 'app/public');
}

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
      throw new YskError(ErrorCodes.VALIDATION, 'deployNode 只適用於 Node 專案', {
        httpStatus: 400,
      });
    }
    assertOsIsolationForDeploy(row, this.host, 'Deploy Node');
    await assertWithinQuota({
      host: this.host,
      projectId,
      homeDir: row.home_dir,
      quotaMb: row.quota_mb,
      action: 'Deploy',
    });

    const notes: string[] = [];
    const written: string[] = [];
    if (!canRunAsProjectUser(row, this.host)) {
      notes.push(
        '隔離模式：degraded — 行程可能以控制面用戶執行；生產請 root + YSK_EXECUTE 並建立系統用戶',
      );
    } else {
      notes.push(`隔離模式：以專案用戶 ${row.linux_user} 運作`);
    }
    const entry = opts.entry ?? 'server.js';
    const nodeBinary = resolveNodeBinary();
    notes.push(`使用 Node 執行檔：${nodeBinary}`);

    const port = opts.port ?? row.port ?? (await findFreePort(3100, 3999));
    notes.push(`目標埠：${port}`);

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
    await chownProjectHome(this.host, row, notes);

    const appDir = apply.appDir;
    const entryPath = join(appDir, entry);
    if (!existsSync(entryPath)) {
      throw new YskError(ErrorCodes.INTERNAL, `套用後找不到進入點：${entryPath}`, {
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
        notes.push(`以 systemd unit 部署：${unitName}`);
      } else {
        notes.push('systemd 啟用失敗 — 改試 PM2／pidfile');
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
        notes.push(`以 PM2 部署：${pm2.appName}`);
      } else if (!this.host.executeEnabled()) {
        notes.push('無法使用 PM2，改用本機行程管理');
      } else {
        notes.push('PM2 啟動失敗 — 改用 pidfile 啟動');
      }
    }

    if (deployMode === 'pidfile') {
      notes.push(
        '目前以本機行程模式部署',
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
          },
          logOutFd: outFd,
          logErrFd: errFd,
          notes,
        });
        child = spawned.child;
        if (spawned.mode === 'degraded') degraded = true;
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
          notes: [...notes, `啟動行程失敗：${msg}`],
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
          notes: [...notes, '啟動行程後未取得行程編號'],
          written,
          degraded: true,
          deployMode: 'pidfile',
        };
      }
      child.unref();
      writeFileSync(pidfile, `${pid}\n`, 'utf8');
      notes.push(`已啟動 pid=${pid}，pidfile=${pidfile}`);
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
      cloudflareRealIp: true,
      forceHttps: false,
      hsts: false,
    });
    const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
    written.push(nginxPath);
    notes.push(`已發布 Nginx 設定（管理檔）：${nginxPath}`);

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
      deploy_entry: entry,
      last_deploy_notes: clipDeployNotes(notes),
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
          '此專案是 Node runtime，請使用 Node 部署（或改 runtime 為 static）',
          { httpStatus: 400 },
        );
      }
    }
    await assertWithinQuota({
      host: this.host,
      projectId,
      homeDir: row.home_dir,
      quotaMb: row.quota_mb,
      action: 'Deploy static',
    });
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
      notes.push(`已建立佔位頁：${indexPath}`);
    } else {
      notes.push(`使用既有：${indexPath}`);
    }

    const primary = row.domain ?? `${row.linux_user}.local`;
    const serverName = buildServerNameList(primary, row.domain_aliases);
    const wantSsl = Boolean(opts.ssl);
    const managed = resolveManagedCertPaths(this.dataDir, primary);
    const conf = renderNginxStatic({
      serverName,
      docRoot,
      ssl: wantSsl && managed.exists,
      cloudflareRealIp: true,
      sslCertificate: wantSsl && managed.exists ? managed.fullchain : undefined,
      sslCertificateKey: wantSsl && managed.exists ? managed.privkey : undefined,
      forceHttps: wantSsl && Boolean(row.force_https),
      hsts: wantSsl && Boolean(row.hsts),
    });
    const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
    written.push(nginxPath);
    notes.push(`靜態 Nginx 設定：${nginxPath}`);
    notes.push(`文件根目錄：${docRoot}`);

    let nginxReloaded = false;
    const wantReload =
      opts.reload === true ||
      (opts.reload !== false && this.host.executeEnabled() && this.host.isRoot());
    if (wantReload && this.host.executeEnabled() && this.host.isRoot()) {
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
            ? '已重載 Nginx (static site live if DNS points here)'
            : `Nginx reload 結束碼=${rel.exitCode}`,
        );
      }
    } else if (wantReload) {
      notes.push('無法重載 Nginx：需要系統變更權限');
    } else {
      notes.push('僅寫入管理設定 — 就緒後再發布並重載');
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
        docRoot,
      },
      last_deploy_at: new Date().toISOString(),
    });

    this.audit?.append({
      actor: opts.actor,
      action: 'project.deploy_static',
      resource: projectId,
      detail: { nginxPath, docRoot, nginxReloaded },
      ok: true,
    });

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
      requiresExecute: !this.host.executeEnabled(),
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
        notes: ['尚未分配埠，請先部署專案'],
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
      forceHttps?: boolean;
      hsts?: boolean;
    },
  ): Promise<OpsApplyResult> {
    const row = this.require(projectId);
    if (row.status === 'suspended') {
      return this.publishSuspendedNginx(projectId, opts.actor);
    }
    const port = row.port ?? 3000;
    const primary = row.domain ?? `${row.linux_user}.local`;
    const serverName = buildServerNameList(primary, row.domain_aliases);
    const wantSsl = opts.ssl ?? false;
    const forceHttps = opts.forceHttps ?? Boolean(row.force_https);
    const hsts = opts.hsts ?? Boolean(row.hsts);
    if (opts.forceHttps !== undefined || opts.hsts !== undefined) {
      this.projects.updateMeta(projectId, {
        force_https: forceHttps,
        hsts,
      });
    }
    const managed = resolveManagedCertPaths(this.dataDir, primary);
    let authBasicUserFile: string | undefined;
    if (row.http_auth_user && row.http_auth_pass) {
      const htDir = join(this.dataDir, 'nginx', 'htpasswd');
      mkdirSync(htDir, { recursive: true });
      authBasicUserFile = join(htDir, `${row.linux_user}.htpasswd`);
      // openssl passwd -apr1 when available; else plain {PLAIN} for demo (nginx may need auth_basic module)
      const hashR = await this.host.runCommand(
        ['openssl', 'passwd', '-apr1', row.http_auth_pass],
        { timeoutMs: 5_000 },
      );
      const hash =
        hashR.exitCode === 0 && hashR.stdout.trim()
          ? hashR.stdout.trim()
          : `{PLAIN}${row.http_auth_pass}`;
      writeFileSync(authBasicUserFile, `${row.http_auth_user}:${hash}\n`, 'utf8');
    }
    const conf = renderNginxProxy({
      serverName,
      upstream: `http://127.0.0.1:${port}`,
      ssl: wantSsl,
      cloudflareRealIp: true,
      sslCertificate: wantSsl && managed.exists ? managed.fullchain : undefined,
      sslCertificateKey: wantSsl && managed.exists ? managed.privkey : undefined,
      forceHttps: wantSsl && forceHttps,
      hsts: wantSsl && hsts,
      siteRedirectUrl: row.site_redirect_url,
      authBasicUserFile,
      authBasicRealm: row.http_auth_user ? 'Restricted' : undefined,
      bindIp: row.bind_ip,
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
    const notes = [`已寫入 Nginx 設定：${nginxPath}`, ...sync.notes];
    if (serverName.includes(' ')) notes.push(`server_name：${serverName}`);
    if (wantSsl && forceHttps) notes.push('強制 HTTPS（HTTP→301）');
    if (wantSsl && hsts) notes.push('已啟用 HSTS');
    if (row.site_redirect_url) notes.push(`整站重新導向 → ${row.site_redirect_url}`);
    if (authBasicUserFile) notes.push(`HTTP 基本認證：${row.http_auth_user}`);
    if (wantSsl && managed.exists) {
      notes.push(`使用已上傳憑證：${managed.fullchain}`);
    } else if (wantSsl) {
      notes.push(
        `已啟用 SSL（預設 Let’s Encrypt 路徑；或於 SSL 頁上傳 ${primary} 憑證）`,
      );
    }
    let nginxReloaded = false;
    let nginxStatus = 'managed_only';
    const wantReload = opts.reload ?? Boolean(systemDir && this.host.executeEnabled());

    if (wantReload && this.host.executeEnabled()) {
      const t = await this.host.runCommand(['nginx', '-t'], { timeoutMs: 10_000 });
      notes.push(
        t.exitCode === 0
          ? 'Nginx 設定檢查通過'
          : `Nginx 設定檢查失敗：${(t.stderr || t.stdout).trim()}`,
      );
      if (t.exitCode === 0) {
        const r = await this.host.runCommand(['systemctl', 'reload', 'nginx'], { timeoutMs: 15_000 });
        nginxReloaded = r.exitCode === 0;
        nginxStatus = nginxReloaded ? 'reloaded' : `reload_failed:${r.stderr}`;
        notes.push(nginxReloaded ? '已重載 Nginx' : `重載 Nginx 失敗：${r.stderr}`);
      } else {
        nginxStatus = 'nginx_t_failed';
      }
    } else if (wantReload) {
      notes.push('無法重載 Nginx：需要系統變更權限');
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
    // Honest ok: if reload requested but blocked/failed → not full success
    const reloadWanted = wantReload;
    const reloadBlocked = reloadWanted && nginxStatus === 'requires_execute';
    const reloadFailed =
      reloadWanted &&
      (nginxStatus === 'nginx_t_failed' || nginxStatus.startsWith('reload_failed'));
    const ok = !reloadBlocked && !reloadFailed;

    this.audit?.append({
      actor: opts.actor,
      action: 'project.publish_nginx',
      resource: projectId,
      detail: { nginxPath, port, sync, nginxReloaded, nginxStatus, serverName, forceHttps, hsts, ok },
      ok,
    });
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
          ? '狀態：written（conf 已寫；reload blocked）'
          : reloadFailed
            ? '狀態：failed（nginx -t 或 reload 失敗）'
            : nginxReloaded
              ? '狀態：applied'
              : '狀態：written',
      ],
      written: [nginxPath, ...sync.copied],
      nginxReloaded,
      nginxStatus,
      requiresExecute: !this.host.executeEnabled(),
      requiresRoot: !this.host.isRoot(),
      degraded: !nginxReloaded,
    };
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
      nginx_config_path: pub.nginxPath,
    });
    this.audit?.append({
      actor,
      action: 'project.suspend',
      resource: projectId,
      detail: { domain: row.domain },
      ok: true,
    });
    return {
      ok: true,
      projectId,
      processStatus: 'stopped',
      listening: false,
      nginxPath: pub.nginxPath,
      notes: ['專案已暫停（503）', ...notes],
      written: pub.written,
      degraded: pub.degraded,
      requiresExecute: pub.requiresExecute,
      requiresRoot: pub.requiresRoot,
      nginxReloaded: pub.nginxReloaded,
      nginxStatus: pub.nginxStatus,
    };
  }

  /**
   * Unsuspend: clear suspended flag and re-publish normal nginx (no SSL by default).
   */
  async unsuspend(projectId: string, actor: string): Promise<OpsApplyResult> {
    this.require(projectId);
    this.projects.updateMeta(projectId, { status: 'stopped' });
    this.projects.updateRuntimeState(projectId, {
      status: 'stopped',
      process_status: 'stopped',
    });
    const pub = await this.publishNginx(projectId, { actor, ssl: false });
    this.audit?.append({
      actor,
      action: 'project.unsuspend',
      resource: projectId,
      detail: {},
      ok: true,
    });
    return {
      ...pub,
      notes: ['專案已恢復', ...pub.notes],
    };
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
      host: this.host,
    });
    const notes = [`已寫入暫停用虛擬主機：${nginxPath}`, ...sync.notes];
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
      throw new YskError(ErrorCodes.VALIDATION, '請提供 Git URL（或先在專案設定）', {
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
    if (git.ok) {
      await chownProjectHome(this.host, row, notes);
    }
    const savedEntry = opts.entry?.trim() || row.deploy_entry?.trim() || undefined;
    let redeployResult: OpsApplyResult | undefined;
    if (git.ok && opts.redeploy !== false) {
      if (row.runtime === 'node') {
        redeployResult = await this.deployNode(projectId, {
          actor: opts.actor,
          entry: savedEntry,
        });
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
          skipBuild: opts.skipBuild,
        });
        notes.push(...redeployResult.notes);
      } else {
        notes.push(`Runtime ${row.runtime} — 只同步 Git，不重啟行程`);
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
      notes: [`已寫入環境變數 ${envPath}（${Object.keys(merged).length} 項）`],
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
        throw new YskError(ErrorCodes.VALIDATION, '此專案是 Node runtime，請使用 Node 部署', {
          httpStatus: 400,
        });
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
      action: 'Deploy PHP',
    });
    const notes: string[] = [];
    const written: string[] = [];
    if (row.runtime === 'php' && canRunAsProjectUser(row, this.host)) {
      notes.push(`PHP-FPM pool 用戶：${row.linux_user}（專案隔離）`);
    } else if (row.runtime === 'php') {
      notes.push('PHP 隔離 degraded — 未以專案 Linux 用戶（需 root + 建立系統用戶）');
    }
    const port = opts.port ?? row.port ?? (await findFreePort(8100, 8999));
    const docRoot = resolveProjectDocRoot(row);
    mkdirSync(docRoot, { recursive: true });
    const domain = row.domain ?? `${row.linux_user}.local`;

    const phpVersion = opts.phpVersion ?? row.runtime_version ?? '8.2';
    const phpRt = selectPhpRuntime(phpVersion);
    if (opts.phpVersion && opts.phpVersion !== row.runtime_version) {
      this.projects.updateMeta(projectId, { runtime_version: phpRt.version });
      notes.push(`runtime 版本 → ${phpRt.version}`);
    }
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
    await chownProjectHome(this.host, row, notes);
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
        serverName: buildServerNameList(domain, row.domain_aliases),
        docRoot,
        fpmSocket,
        ssl: false,
        cloudflareRealIp: true,
        forceHttps: false,
        hsts: false,
      });
      const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
      written.push(nginxPath);
      notes.push(`PHP-FPM 生產 Nginx 設定：${nginxPath}`);
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
              ? '已重載 Nginx'
              : `Nginx reload 結束碼=${rel.exitCode}: ${rel.stderr}`,
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
        '目前以簡易 PHP 模式部署',
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
        notes: [...notes, 'php binary 找不到 — install php-cli'],
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
    const phpShell = `${shellQuote(phpBin)} -S 127.0.0.1:${port} -t ${shellQuote(docRoot)}`;
    const { child, mode: phpMode } = spawnAsProjectUser({
      row,
      host: this.host,
      shellCmd: phpShell,
      cwd: docRoot,
      env: { ...process.env, PORT: String(port) },
      logOutFd: outFd,
      logErrFd: errFd,
      notes,
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
        notes: [...notes, 'PHP 行程啟動後未取得行程編號'],
        written,
        degraded: true,
        deployMode: 'pidfile',
      };
    }
    child.unref();
    writeFileSync(pidfile, `${pid}\n`, 'utf8');
    notes.push(
      `PHP 內建伺服器 pid=${pid} @ 127.0.0.1:${port}` +
        (phpMode === 'isolated' ? `（user=${row.linux_user}）` : '（degraded）'),
    );
    await chownProjectHome(this.host, row, notes);

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
      throw new YskError(ErrorCodes.VALIDATION, 'memoryMax 格式須如 512M 或 1G', {
        httpStatus: 400,
      });
    }
    if (
      resources.cpuQuotaPercent != null &&
      (!Number.isFinite(resources.cpuQuotaPercent) ||
        resources.cpuQuotaPercent < 1 ||
        resources.cpuQuotaPercent > 10000)
    ) {
      throw new YskError(ErrorCodes.VALIDATION, 'CPU 配額須為 1–10000', { httpStatus: 400 });
    }
    if (
      resources.tasksMax != null &&
      (!Number.isFinite(resources.tasksMax) ||
        resources.tasksMax < 1 ||
        resources.tasksMax > 1_000_000)
    ) {
      throw new YskError(ErrorCodes.VALIDATION, 'TasksMax 須為 1–1000000', { httpStatus: 400 });
    }
    if (
      resources.limitNofile != null &&
      (!Number.isFinite(resources.limitNofile) ||
        resources.limitNofile < 64 ||
        resources.limitNofile > 10_000_000)
    ) {
      throw new YskError(ErrorCodes.VALIDATION, 'LimitNOFILE 須為 64–10000000', {
        httpStatus: 400,
      });
    }
    this.projects.updateRuntimeState(projectId, {
      memory_max: resources.memoryMax,
      cpu_quota_percent: resources.cpuQuotaPercent,
      tasks_max: resources.tasksMax,
      limit_nofile: resources.limitNofile,
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
        `tasksMax=${resources.tasksMax ?? row.tasks_max ?? 'unset'}`,
        `limitNofile=${resources.limitNofile ?? row.limit_nofile ?? 'unset'}`,
        '已寫入控制面；請用「套用限制到 OS」或重新 Deploy 寫入 unit',
      ],
      written: [],
    };
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
      notes: [
        `quota=${quotaMb}MB`,
        `used=${quota.usedMb}MB`,
        ...quota.notes,
        '軟配額已存；硬 setquota 請「套用限制到 OS」',
      ],
      written: [],
      quota,
    };
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
        accountLocked: row.account_locked,
      },
    };
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
        throw new YskError(ErrorCodes.VALIDATION, 'shell 路徑無效', { httpStatus: 400 });
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
      quota_mb: patch.quotaMb,
    });
    const fresh = this.require(projectId);
    const result = await applyOsUserLimits({
      host: this.host,
      row: fresh,
      dataDir: this.dataDir,
    });
    this.audit?.append({
      actor,
      action: 'project.os_user_patch',
      resource: projectId,
      detail: { patch, result },
      ok: result.ok,
    });
    return { ...result, projectId };
  }

  async applyOsLimits(projectId: string, actor: string): Promise<ApplyOsLimitsResult & { projectId: string }> {
    const row = this.require(projectId);
    const result = await applyOsUserLimits({
      host: this.host,
      row,
      dataDir: this.dataDir,
    });
    this.audit?.append({
      actor,
      action: 'project.os_user_apply_limits',
      resource: projectId,
      detail: result,
      ok: result.ok,
    });
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
      ok: r.ok,
    });
    return { ...r, projectId };
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
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到專案：${id}`, { httpStatus: 404 });
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
        notes.push(`已送 SIGTERM 至 ${pid}`);
        await waitUntilDead(pid, 3000);
        if (isPidAlive(pid)) {
          process.kill(pid, 'SIGKILL');
          notes.push(`已送 SIGKILL 至 ${pid}`);
        }
      } catch (e) {
        notes.push(`kill ${pid}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (pid) {
      notes.push(`pid ${pid} 已結束`);
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
        `deployProcess 不適用於 runtime「${row.runtime}」`,
        { httpStatus: 400 },
      );
    }

    assertOsIsolationForDeploy(row, this.host, 'Deploy');
    await assertWithinQuota({
      host: this.host,
      projectId,
      homeDir: row.home_dir,
      quotaMb: row.quota_mb,
      action: 'Deploy',
    });

    const notes: string[] = [];
    const written: string[] = [];
    if (!canRunAsProjectUser(row, this.host)) {
      notes.push(
        '隔離模式：degraded — build／行程可能以控制面用戶執行；生產請建立系統用戶',
      );
    } else {
      notes.push(`隔離模式：以專案用戶 ${row.linux_user} 建置與啟動`);
    }
    const appDir = join(row.home_dir, 'app');
    mkdirSync(appDir, { recursive: true });
    mkdirSync(join(row.home_dir, 'logs'), { recursive: true });

    const port = opts.port ?? row.port ?? (await findFreePort(3200, 3999));
    const cargoName = resolveCargoPackageName(appDir);
    // entry: request → saved deploy_entry → auto-detect (python/rust)
    let entry = opts.entry?.trim() || row.deploy_entry?.trim() || undefined;
    if (!entry && row.runtime === 'python') {
      entry = detectPythonEntry(appDir) ?? undefined;
    }
    if (!entry && row.runtime === 'rust' && cargoName) {
      entry = `./target/release/${cargoName}`;
    }
    const cmds = defaultProcessCommands(row.runtime, {
      version: row.runtime_version,
      entry,
      port,
      cargoName: cargoName ?? undefined,
    });
    notes.push(`Runtime：${row.runtime} · 埠 ${port} · entry ${cmds.entry}`);

    await this.stopProcess(row, notes);

    if (cmds.build && !opts.skipBuild) {
      notes.push(`建置：${cmds.build}`);
      const build = await runAsProjectUser(this.host, row, cmds.build, {
        timeoutMs: 600_000,
        cwd: appDir,
        notes,
      });
      if (build.exitCode !== 0) {
        notes.push(`建置失敗：${(build.stderr || build.stdout || '').slice(0, 400)}`);
        this.projects.updateRuntimeState(projectId, {
          process_status: 'failed',
          status: 'failed',
          port,
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
          requiresExecute: !this.host.executeEnabled(),
        };
      }
      notes.push('建置完成');
      await chownProjectHome(this.host, row, notes);
    }

    const unitBody = renderProcessUnit({
      projectName: row.name,
      linuxUser: row.linux_user,
      appDir,
      homeDir: row.home_dir,
      execStart: cmds.execStart,
      port,
      env: { PORT: String(port), HOST: '127.0.0.1' },
      memoryMax: row.memory_max,
      cpuQuotaPercent: row.cpu_quota_percent,
      tasksMax: row.tasks_max,
      limitNOFILE: row.limit_nofile,
    });
    const unitManaged = join(this.dataDir, 'systemd', `ysk-project-${row.linux_user}.service`);
    mkdirSync(join(this.dataDir, 'systemd'), { recursive: true });
    writeFileSync(unitManaged, unitBody, 'utf8');
    written.push(unitManaged);
    notes.push(`已寫入 systemd 範本：${unitManaged}`);

    let unitActive = false;
    if (this.host.executeEnabled() && this.host.isRoot() && row.os_provisioned) {
      const systemUnit = `/etc/systemd/system/ysk-project-${row.linux_user}.service`;
      try {
        writeFileSync(systemUnit, unitBody, 'utf8');
        written.push(systemUnit);
        await this.host.runCommand(['systemctl', 'daemon-reload'], { timeoutMs: 15_000 });
        const en = await this.host.runCommand(
          ['systemctl', 'enable', '--now', `ysk-project-${row.linux_user}.service`],
          { timeoutMs: 30_000 },
        );
        if (en.exitCode === 0) {
          notes.push(`已 enable --now 專案 unit（User=${row.linux_user}）`);
          unitActive = true;
        } else notes.push(`systemctl 啟動失敗：${en.stderr || en.stdout}`);
      } catch (e) {
        notes.push(`寫入系統 unit 失敗：${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      notes.push('未以系統 unit 啟動（需 root + 已隔離）— 改用 pidfile');
    }

    const pidfile = join(row.home_dir, 'app.pid');
    let pid: number | undefined;
    if (!unitActive) {
      const active = await this.host.runCommand(
        ['systemctl', 'is-active', `ysk-project-${row.linux_user}.service`],
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
        const { child, mode } = spawnAsProjectUser({
          row,
          host: this.host,
          shellCmd: cmds.execStart,
          cwd: appDir,
          env: {
            ...process.env,
            PORT: String(port),
            HOST: '127.0.0.1',
          },
          logOutFd: outFd,
          logErrFd: errFd,
          notes,
        });
        closeSync(outFd);
        closeSync(errFd);
        pid = child.pid;
        if (pid) {
          child.unref();
          writeFileSync(pidfile, `${pid}\n`, 'utf8');
          notes.push(
            `pidfile 啟動 pid=${pid}${mode === 'isolated' ? `（user=${row.linux_user}）` : '（degraded）'}`,
          );
        } else {
          notes.push('pidfile 啟動未取得 pid');
        }
      } catch (err) {
        notes.push(`pidfile 啟動失敗：${err instanceof Error ? err.message : String(err)}`);
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
          ? '埠檢查異常'
          : `健康檢查未通過（${health.ms}ms）：${health.error ?? health.status}`,
      );
    } else {
      notes.push(`健康檢查通過（${health.ms}ms）`);
    }

    const serverName = buildServerNameList(
      row.domain ?? `${row.linux_user}.local`,
      row.domain_aliases,
    );
    const conf = renderNginxProxy({
      serverName,
      upstream: `http://127.0.0.1:${port}`,
      ssl: false,
      cloudflareRealIp: true,
      forceHttps: false,
      hsts: false,
      siteRedirectUrl: row.site_redirect_url,
      bindIp: row.bind_ip,
    });
    const nginxPath = writeManagedNginxConf(this.dataDir, `${row.linux_user}.conf`, conf);
    written.push(nginxPath);
    notes.push(`已寫入 Nginx 反代：${nginxPath}`);

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
      },
      last_deploy_at: new Date().toISOString(),
      nginx_config_path: nginxPath,
      deploy_entry: cmds.entry,
      last_deploy_notes: clipDeployNotes(notes),
    });

    this.audit?.append({
      actor: opts.actor,
      action: 'project.deploy_process',
      resource: projectId,
      detail: { runtime: row.runtime, port, processStatus, entry: cmds.entry },
      ok: processStatus === 'running',
    });

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
      requiresRoot: !this.host.isRoot(),
      requiresExecute: !this.host.executeEnabled(),
    };
  }
}

export function resolveNodeBinary(): string {
  // Prefer current process binary so deploy works without custom node install
  if (process.execPath && existsSync(process.execPath)) return process.execPath;
  return 'node';
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
