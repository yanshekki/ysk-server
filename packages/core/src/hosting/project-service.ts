/**
 * Real project lifecycle: DB + disk under dataDir/projects.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectDto } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import {
  isCanonicalProjectHome,
  isSafeProjectHomePath,
  planProjectIsolation,
  projectHomeDir,
} from './project.js';
import { planIsolationMigration } from './project-isolation-status.js';
import { webGroupProvisionCommands } from './project-web-group.js';
import { renderNginxProxy } from './nginx-ssl.js';
import type { ProjectRepository, ProjectRow } from '../repositories/project-repo.js';
import type { HostExecutor } from '../host/executor.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import { getAppTemplate, scaffoldAppTemplate, type AppTemplateId } from './app-templates.js';
import { normalizeRuntimeVersion } from './runtime.js';
import { normalizeExtraLogDirs } from './project-logs.js';

export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly host: HostExecutor,
    private readonly dataDir: string,
    private readonly audit?: AuditRepository,
  ) {}

  list(): ProjectDto[] {
    return this.projects.list().map((row) => this.healRuntimeVersion(row));
  }

  get(id: string): ProjectDto {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到專案：${id}`, { httpStatus: 404 });
    }
    return this.healRuntimeVersion(row);
  }

  /** Repair PHP projects that were incorrectly stored with Node default "20". */
  private healRuntimeVersion(row: ProjectRow): ProjectDto {
    const fixed = normalizeRuntimeVersion(row.runtime, row.runtime_version);
    if (fixed !== (row.runtime_version ?? '')) {
      this.projects.updateMeta(row.id, { runtime_version: fixed });
      row = { ...row, runtime_version: fixed };
    }
    return toDto(row);
  }

  /**
   * Create project record + home directory on disk.
   * OS useradd only when YSK_EXECUTE=1 and process is root.
   */
  async create(input: {
    name: string;
    domain?: string;
    domainAliases?: string[];
    runtime: ProjectDto['runtime'];
    runtimeVersion?: string;
    env?: 'staging' | 'production';
    actor: string;
    /** Optional one-click template */
    templateId?: string;
    forceTemplate?: boolean;
  }): Promise<{
    project: ProjectDto;
    osProvision: { attempted: boolean; ok: boolean; detail: string };
    plan: string[];
    scaffold?: ReturnType<typeof scaffoldAppTemplate>;
  }> {
    if (!input.name?.trim()) {
      throw new YskError(ErrorCodes.VALIDATION, '請填寫專案名稱', { httpStatus: 400 });
    }
    let runtime = input.runtime;
    let runtimeVersion = input.runtimeVersion;
    if (input.templateId) {
      const tpl = getAppTemplate(input.templateId);
      runtime = tpl.runtime;
      runtimeVersion = runtimeVersion ?? tpl.runtimeVersion;
    }
    // Never default PHP to Node "20" — resolve by runtime kind
    runtimeVersion = normalizeRuntimeVersion(runtime, runtimeVersion);
    const id = randomUUID();
    const plan = planProjectIsolation({
      id,
      name: input.name,
      domain: input.domain,
      runtime,
      runtimeVersion,
      env: input.env,
    });

    const canOs = this.host.executeEnabled() && this.host.isRoot();
    // Canonical production home: /home/ysk-server-{id}
    // Degraded (no root): writable shadow under dataDir until provision migrates
    const canonicalHome = plan.project.homeDir; // /home/ysk-server-{id}
    const shadowHome = join(this.dataDir, 'homes', `ysk-server-${id}`);
    let homeDir = canOs ? canonicalHome : shadowHome;

    let osProvision = {
      attempted: false,
      ok: false,
      detail: canOs
        ? '準備建立系統用戶…'
        : `尚未建立系統用戶（需要系統管理員權限）。意圖 home：${canonicalHome}；目前使用控制面陰影目錄。`,
    };

    if (canOs) {
      osProvision = await this.provisionOsUser(
        plan.commands,
        plan.project.linuxUser,
        canonicalHome,
      );
      if (osProvision.ok) {
        homeDir = canonicalHome;
      } else {
        // Fall back to shadow so control-plane files still work; stay not provisioned
        homeDir = shadowHome;
        osProvision = {
          ...osProvision,
          ok: false,
          detail: `${osProvision.detail}；已改用陰影 home ${shadowHome}`,
        };
      }
    }

    await this.host.mkdirp(join(homeDir, 'app'));
    await this.host.mkdirp(join(homeDir, 'logs'));
    await this.host.mkdirp(join(homeDir, 'tmp'));
    writeFileSync(
      join(homeDir, 'project.json'),
      JSON.stringify(
        {
          id,
          name: input.name,
          linuxUser: plan.project.linuxUser,
          canonicalHome,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );

    if (canOs && homeDir === canonicalHome) {
      // Ensure ownership after writing control-plane files
      await this.host.runCommand(
        [
          'bash',
          '-c',
          `chown -R ${plan.project.linuxUser}:${plan.project.linuxGroup} ${JSON.stringify(homeDir)} && chmod 750 ${JSON.stringify(homeDir)}`,
        ],
        { timeoutMs: 15_000 },
      ).catch(() => undefined);
    }

    // Optional nginx config in dataDir (port filled on deploy)
    let nginxPath: string | undefined;
    if (input.domain) {
      const confDir = join(this.dataDir, 'nginx', 'conf.d');
      mkdirSync(confDir, { recursive: true });
      const conf = renderNginxProxy({
        serverName: input.domain,
        upstream: `http://127.0.0.1:3100`,
        ssl: false,
        cloudflareRealIp: true,
      });
      nginxPath = join(confDir, `${plan.project.linuxUser}.conf`);
      writeFileSync(nginxPath, conf, 'utf8');
    }

    let scaffold: ReturnType<typeof scaffoldAppTemplate> | undefined;
    if (input.templateId) {
      scaffold = scaffoldAppTemplate({
        templateId: input.templateId as AppTemplateId,
        homeDir,
        projectName: input.name,
        domain: input.domain,
        force: input.forceTemplate,
      });
    }

    const aliases = normalizeAliases(input.domainAliases, input.domain);
    const now = new Date().toISOString();
    const row: ProjectRow = {
      id,
      name: plan.project.name,
      domain: input.domain,
      domain_aliases: aliases,
      linux_user: plan.project.linuxUser,
      linux_group: plan.project.linuxGroup,
      home_dir: homeDir,
      runtime,
      runtime_version: runtimeVersion,
      env: input.env ?? 'production',
      status: osProvision.ok ? 'active' : 'active_pending_os',
      nginx_config_path: nginxPath,
      os_provisioned: osProvision.ok,
      force_https: false,
      hsts: false,
      created_at: now,
      updated_at: now,
    };
    this.projects.insert(row);
    this.audit?.append({
      actor: input.actor,
      action: 'project.create',
      resource: id,
      detail: {
        name: input.name,
        homeDir,
        canonicalHome,
        osProvision,
        templateId: input.templateId,
        scaffold,
      },
      ok: true,
    });

    return {
      project: toDto(row),
      osProvision,
      plan: plan.commands,
      scaffold,
    };
  }

  /**
   * Re-attempt Linux user/group isolation for an existing project (root + EXECUTE).
   * Migrates degraded shadow home → /home/ysk-server-{id} when needed.
   * Never fakes success.
   */
  async provisionOsIsolation(
    id: string,
    actor: string,
  ): Promise<{
    ok: boolean;
    osProvision: { attempted: boolean; ok: boolean; detail: string };
    requiresExecute: boolean;
    requiresRoot: boolean;
    homeDir?: string;
  }> {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到專案：${id}`, { httpStatus: 404 });
    }
    if (!this.host.executeEnabled() || !this.host.isRoot()) {
      return {
        ok: false,
        osProvision: {
          attempted: false,
          ok: false,
          detail: '建立系統用戶需要系統管理員權限',
        },
        requiresExecute: !this.host.executeEnabled(),
        requiresRoot: !this.host.isRoot(),
      };
    }

    const canonicalHome = projectHomeDir(id);
    const previousHome = row.home_dir;
    const commands = [
      `groupadd --system ${row.linux_group} 2>/dev/null || true`,
      `id ${row.linux_user} >/dev/null 2>&1 || useradd --system --gid ${row.linux_group} --home-dir ${canonicalHome} --create-home --shell /usr/sbin/nologin ${row.linux_user}`,
      // If user exists with different home, fix home path in passwd
      `usermod -d ${canonicalHome} ${row.linux_user} 2>/dev/null || true`,
      `mkdir -p ${canonicalHome}/app ${canonicalHome}/logs ${canonicalHome}/tmp`,
    ];

    // Migrate files from shadow/legacy home if different
    if (
      previousHome &&
      previousHome !== canonicalHome &&
      existsSync(previousHome) &&
      isSafeProjectHomePath(previousHome, {
        projectId: id,
        dataDir: this.dataDir,
        linuxUser: row.linux_user,
      })
    ) {
      commands.push(
        `cp -a ${JSON.stringify(previousHome + '/.')} ${JSON.stringify(canonicalHome + '/')} 2>/dev/null || true`,
      );
    }

    commands.push(
      `chown -R ${row.linux_user}:${row.linux_group} ${canonicalHome}`,
      `chmod 750 ${canonicalHome}`,
    );
    // Nginx/static: ysk-web group so www-data can read without world-readable home
    commands.push(...webGroupProvisionCommands(row.linux_user, canonicalHome));

    const osProvision = await this.provisionOsUser(commands, row.linux_user, canonicalHome);
    if (osProvision.ok) {
      this.projects.updateMeta(id, { home_dir: canonicalHome });
      this.projects.setOsProvisioned(id, true);
    } else {
      this.projects.setOsProvisioned(id, false);
    }
    this.audit?.append({
      actor,
      action: 'project.os_provision',
      resource: id,
      detail: { osProvision, plan: commands, previousHome, canonicalHome },
      ok: osProvision.ok,
    });
    return {
      ok: osProvision.ok,
      osProvision,
      requiresExecute: false,
      requiresRoot: false,
      homeDir: osProvision.ok ? canonicalHome : previousHome,
    };
  }

  /**
   * Explicit migrate: stop unit best-effort → provision home at /home/ysk-server-{id}
   * → optional remove previous safe home. Operator must confirm (UI).
   * Keeps existing linux_user (legacy name-slug users retained).
   */
  async migrateOsIsolation(
    id: string,
    actor: string,
    opts?: { removePreviousHome?: boolean },
  ): Promise<{
    ok: boolean;
    notes: string[];
    plan: ReturnType<typeof planIsolationMigration>;
    osProvision?: { attempted: boolean; ok: boolean; detail: string };
    requiresExecute: boolean;
    requiresRoot: boolean;
    homeDir?: string;
  }> {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到專案：${id}`, { httpStatus: 404 });
    }
    const plan = planIsolationMigration({
      id: row.id,
      name: row.name,
      linuxUser: row.linux_user,
      homeDir: row.home_dir,
      osProvisioned: row.os_provisioned,
    });
    const notes = [...plan.reasons];

    if (!plan.needsMigration && row.os_provisioned && isCanonicalProjectHome(row.home_dir, id)) {
      notes.push('已符合意圖隔離，無需遷移');
      return {
        ok: true,
        notes,
        plan,
        requiresExecute: !this.host.executeEnabled(),
        requiresRoot: !this.host.isRoot(),
        homeDir: row.home_dir,
      };
    }

    if (!this.host.executeEnabled() || !this.host.isRoot()) {
      notes.push('遷移需要 YSK_EXECUTE + root');
      return {
        ok: false,
        notes,
        plan,
        requiresExecute: !this.host.executeEnabled(),
        requiresRoot: !this.host.isRoot(),
      };
    }

    // Stop project unit before moving home
    const unit = `ysk-project-${row.linux_user}.service`;
    await this.host
      .runCommand(['systemctl', 'stop', unit], { timeoutMs: 15_000 })
      .catch(() => undefined);
    notes.push(`已嘗試停止 ${unit}`);

    const previousHome = row.home_dir;
    const prov = await this.provisionOsIsolation(id, actor);
    notes.push(prov.osProvision.detail);

    if (prov.ok && opts?.removePreviousHome !== false && previousHome !== prov.homeDir) {
      if (
        previousHome &&
        existsSync(previousHome) &&
        isSafeProjectHomePath(previousHome, {
          projectId: id,
          dataDir: this.dataDir,
          linuxUser: row.linux_user,
        })
      ) {
        // Only remove if canonical has content (project.json or app)
        const canonical = projectHomeDir(id);
        if (existsSync(join(canonical, 'app')) || existsSync(join(canonical, 'project.json'))) {
          try {
            rmSync(previousHome, { recursive: true, force: true });
            notes.push(`已移除舊 home：${previousHome}`);
          } catch (e) {
            notes.push(
              `舊 home 未刪（可手動）：${previousHome} — ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        } else {
          notes.push('跳過刪舊 home：目標 canonical 內容不完整');
        }
      }
    }

    this.audit?.append({
      actor,
      action: 'project.os_migrate',
      resource: id,
      detail: { plan, notes, ok: prov.ok },
      ok: prov.ok,
    });

    return {
      ok: prov.ok,
      notes,
      plan,
      osProvision: prov.osProvision,
      requiresExecute: false,
      requiresRoot: false,
      homeDir: prov.homeDir,
    };
  }

  private async provisionOsUser(
    commands: string[],
    linuxUser: string,
    homeDir: string,
  ): Promise<{ attempted: boolean; ok: boolean; detail: string }> {
    const results: string[] = [];
    for (const cmd of commands) {
      // Shell required for `|| true`, brace expansion, redirects
      const r = await this.host.runCommand(['bash', '-c', cmd], { timeoutMs: 60_000 });
      const okish =
        r.exitCode === 0 ||
        /already exists|exists/i.test(r.stderr) ||
        /already exists|exists/i.test(r.stdout);
      results.push(`${cmd} => exit ${r.exitCode}${okish && r.exitCode !== 0 ? ' (ok-ish)' : ''}`);
    }
    // Verify user exists when possible
    const idCheck = await this.host.runCommand(
      ['bash', '-c', `id ${linuxUser} >/dev/null 2>&1; echo $?`],
      { timeoutMs: 5_000 },
    );
    const userExists = idCheck.stdout.trim().endsWith('0') || idCheck.stdout.trim() === '0';
    const homeOk = existsSync(homeDir);
    // Require real user identity — do not treat command noise as success without id(1)
    const ok = Boolean(userExists && homeOk);
    return {
      attempted: true,
      ok,
      detail: [...results, `id ${linuxUser}: ${userExists}`, `home exists: ${homeOk}`].join('; '),
    };
  }

  /**
   * Apply template onto existing project home.
   */
  applyTemplate(
    id: string,
    templateId: string,
    actor: string,
    force = false,
  ): { project: ProjectDto; scaffold: ReturnType<typeof scaffoldAppTemplate> } {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到專案：${id}`, { httpStatus: 404 });
    }
    const meta = getAppTemplate(templateId);
    const scaffold = scaffoldAppTemplate({
      templateId,
      homeDir: row.home_dir,
      projectName: row.name,
      domain: row.domain,
      force,
    });
    this.projects.updateMeta(id, {
      runtime: meta.runtime,
      runtime_version: meta.runtimeVersion,
    });
    this.audit?.append({
      actor,
      action: 'project.template',
      resource: id,
      detail: { templateId, scaffold },
      ok: scaffold.ok,
    });
    return { project: this.get(id), scaffold };
  }

  async delete(id: string, actor: string, removeFiles = true): Promise<void> {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到專案：${id}`, { httpStatus: 404 });
    }
    // Best-effort stop managed process before removing files
    const pid = row.pid;
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already dead */
      }
    }
    const unit = `ysk-project-${row.linux_user}.service`;
    if (this.host.executeEnabled() && this.host.isRoot()) {
      await this.host
        .runCommand(['systemctl', 'disable', '--now', unit], { timeoutMs: 15_000 })
        .catch(() => undefined);
      // Remove system unit if present
      await this.host
        .runCommand(['bash', '-c', `rm -f /etc/systemd/system/${unit}`], { timeoutMs: 5_000 })
        .catch(() => undefined);
      await this.host
        .runCommand(['systemctl', 'daemon-reload'], { timeoutMs: 15_000 })
        .catch(() => undefined);
    }

    const deleteNotes: string[] = [];
    if (removeFiles && row.home_dir && existsSync(row.home_dir)) {
      const safe = isSafeProjectHomePath(row.home_dir, {
        projectId: id,
        dataDir: this.dataDir,
        linuxUser: row.linux_user,
      });
      if (!safe) {
        deleteNotes.push(`拒絕刪除不安全 home 路徑：${row.home_dir}`);
      } else if (this.host.executeEnabled() && this.host.isRoot()) {
        // Prefer userdel -r when home is passwd home; else rm after userdel
        const ud = await this.host.runCommand(
          ['bash', '-c', `userdel -r ${row.linux_user} 2>&1 || userdel ${row.linux_user} 2>&1 || true`],
          { timeoutMs: 30_000 },
        );
        deleteNotes.push(`userdel: ${(ud.stdout || ud.stderr || '').slice(0, 200)}`);
        if (existsSync(row.home_dir)) {
          await this.host.deletePath(row.home_dir).catch(() => {
            rmSync(row.home_dir, { recursive: true, force: true });
          });
          deleteNotes.push(`removed home ${row.home_dir}`);
        }
        await this.host
          .runCommand(
            ['bash', '-c', `groupdel ${row.linux_group} 2>/dev/null || true`],
            { timeoutMs: 5_000 },
          )
          .catch(() => undefined);
      } else {
        // Control-plane shadow / dataDir only
        const underData =
          row.home_dir.startsWith(join(this.dataDir, 'projects')) ||
          row.home_dir.startsWith(join(this.dataDir, 'homes'));
        if (underData) {
          if (this.host.executeEnabled()) {
            await this.host.deletePath(row.home_dir);
          } else {
            rmSync(row.home_dir, { recursive: true, force: true });
          }
          deleteNotes.push(`removed control-plane home ${row.home_dir}`);
        } else {
          deleteNotes.push(
            `未刪 OS home（需 root）：${row.home_dir}；系統用戶 ${row.linux_user} 可能仍存在`,
          );
        }
      }
    }

    // Also remove shadow if DB pointed at canonical but shadow left behind
    const shadow = join(this.dataDir, 'homes', `ysk-server-${id}`);
    if (removeFiles && existsSync(shadow) && shadow !== row.home_dir) {
      rmSync(shadow, { recursive: true, force: true });
      deleteNotes.push(`removed shadow ${shadow}`);
    }

    if (row.nginx_config_path && existsSync(row.nginx_config_path)) {
      rmSync(row.nginx_config_path, { force: true });
    }
    this.projects.delete(id);
    this.audit?.append({
      actor,
      action: 'project.delete',
      resource: id,
      detail: { home_dir: row.home_dir, linux_user: row.linux_user, notes: deleteNotes },
      ok: true,
    });
  }

  /**
   * Set extra log scan directories (relative to home). Always also scans logs/ and log/.
   */
  setLogExtraDirs(
    id: string,
    dirs: string[] | string,
    actor: string,
  ): { project: ProjectDto; notes: string[] } {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到專案：${id}`, { httpStatus: 404 });
    }
    const { dirs: cleaned, notes } = normalizeExtraLogDirs(dirs);
    this.projects.updateMeta(id, { log_extra_dirs: cleaned });
    this.audit?.append({
      actor,
      action: 'project.log_extra_dirs',
      resource: id,
      detail: { dirs: cleaned, notes },
      ok: true,
    });
    return { project: this.get(id), notes };
  }

  /** Update network fields (domain, aliases, HTTPS flags). Does not publish nginx. */
  updateNetwork(
    id: string,
    patch: {
      domain?: string;
      domainAliases?: string[];
      forceHttps?: boolean;
      hsts?: boolean;
      siteRedirectUrl?: string | null;
      httpAuthUser?: string | null;
      httpAuthPass?: string | null;
      docRoot?: string | null;
      bindIp?: string | null;
    },
    actor: string,
  ): ProjectDto {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `找不到專案：${id}`, { httpStatus: 404 });
    }
    const domain = patch.domain !== undefined ? patch.domain.trim() || undefined : row.domain;
    const aliases =
      patch.domainAliases !== undefined
        ? normalizeAliases(patch.domainAliases, domain)
        : (row.domain_aliases ?? []);
    this.projects.updateMeta(id, {
      domain,
      domain_aliases: aliases,
      force_https: patch.forceHttps !== undefined ? patch.forceHttps : row.force_https,
      hsts: patch.hsts !== undefined ? patch.hsts : row.hsts,
      site_redirect_url:
        patch.siteRedirectUrl === null
          ? undefined
          : patch.siteRedirectUrl !== undefined
            ? patch.siteRedirectUrl.trim() || undefined
            : row.site_redirect_url,
      http_auth_user:
        patch.httpAuthUser === null
          ? undefined
          : patch.httpAuthUser !== undefined
            ? patch.httpAuthUser.trim() || undefined
            : row.http_auth_user,
      http_auth_pass:
        patch.httpAuthPass === null
          ? undefined
          : patch.httpAuthPass !== undefined
            ? patch.httpAuthPass || undefined
            : row.http_auth_pass,
      doc_root:
        patch.docRoot === null
          ? undefined
          : patch.docRoot !== undefined
            ? patch.docRoot.trim().replace(/^\//, '') || undefined
            : row.doc_root,
      bind_ip:
        patch.bindIp === null
          ? undefined
          : patch.bindIp !== undefined
            ? patch.bindIp.trim() || undefined
            : row.bind_ip,
    });
    this.audit?.append({
      actor,
      action: 'project.update_network',
      resource: id,
      detail: { ...patch, httpAuthPass: patch.httpAuthPass ? '***' : undefined },
      ok: true,
    });
    return this.get(id);
  }
}

function toDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    domainAliases: row.domain_aliases ?? [],
    linuxUser: row.linux_user,
    linuxGroup: row.linux_group,
    homeDir: row.home_dir,
    runtime: row.runtime,
    runtimeVersion: normalizeRuntimeVersion(row.runtime, row.runtime_version) || undefined,
    env: row.env,
    status: row.status,
    port: row.port,
    pid: row.pid,
    processStatus: row.process_status,
    nginxConfigPath: row.nginx_config_path,
    forceHttps: Boolean(row.force_https),
    hsts: Boolean(row.hsts),
    siteRedirectUrl: row.site_redirect_url,
    httpAuthUser: row.http_auth_user,
    docRoot: row.doc_root,
    bindIp: row.bind_ip,
    lastHealth: row.last_health,
    lastDeployAt: row.last_deploy_at,
    osProvisioned: row.os_provisioned,
    gitUrl: row.git_url,
    gitBranch: row.git_branch,
    gitCommit: row.git_commit,
    envVars: row.env_vars,
    lastBackupPath: row.last_backup_path,
    lastBackupAt: row.last_backup_at,
    quotaMb: row.quota_mb,
    memoryMax: row.memory_max,
    cpuQuotaPercent: row.cpu_quota_percent,
    tasksMax: row.tasks_max,
    limitNofile: row.limit_nofile,
    shell: row.shell,
    accountLocked: row.account_locked,
    deployEntry: row.deploy_entry,
    lastDeployNotes: row.last_deploy_notes,
    logExtraDirs: row.log_extra_dirs ?? [],
  };
}

function normalizeAliases(aliases: string[] | undefined, primary?: string): string[] {
  const primaryNorm = (primary ?? '').trim().toLowerCase();
  const out: string[] = [];
  for (const a of aliases ?? []) {
    const n = a.trim().toLowerCase();
    if (!n || n === primaryNorm) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}
