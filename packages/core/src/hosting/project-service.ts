/**
 * Real project lifecycle: DB + disk under dataDir/projects.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectDto } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';
import { deriveLinuxUser, planProjectIsolation } from './project.js';
import { renderNginxProxy } from './nginx-ssl.js';
import type { ProjectRepository, ProjectRow } from '../repositories/project-repo.js';
import type { HostExecutor } from '../host/executor.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import { getAppTemplate, scaffoldAppTemplate, type AppTemplateId } from './app-templates.js';

export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly host: HostExecutor,
    private readonly dataDir: string,
    private readonly audit?: AuditRepository,
  ) {}

  list(): ProjectDto[] {
    return this.projects.list().map(toDto);
  }

  get(id: string): ProjectDto {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `Project not found: ${id}`, { httpStatus: 404 });
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
      throw new YskError(ErrorCodes.VALIDATION, 'Project name is required', { httpStatus: 400 });
    }
    let runtime = input.runtime;
    let runtimeVersion = input.runtimeVersion;
    if (input.templateId) {
      const tpl = getAppTemplate(input.templateId);
      runtime = tpl.runtime;
      runtimeVersion = runtimeVersion ?? tpl.runtimeVersion;
    }
    const id = randomUUID();
    const plan = planProjectIsolation({
      id,
      name: input.name,
      domain: input.domain,
      runtime,
      runtimeVersion,
      env: input.env,
    });

    // Always create home under control-plane dataDir (real, no root needed)
    const homeDir = join(this.dataDir, 'projects', plan.project.linuxUser);
    await this.host.mkdirp(join(homeDir, 'app'));
    await this.host.mkdirp(join(homeDir, 'logs'));
    await this.host.mkdirp(join(homeDir, 'tmp'));
    writeFileSync(
      join(homeDir, 'project.json'),
      JSON.stringify({ id, name: input.name, createdAt: new Date().toISOString() }, null, 2),
      'utf8',
    );

    let osProvision = {
      attempted: false,
      ok: false,
      detail: '尚未建立系統用戶（需要系統管理員權限）',
    };

    if (this.host.executeEnabled() && this.host.isRoot()) {
      osProvision = await this.provisionOsUser(plan.commands, plan.project.linuxUser, homeDir);
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
      detail: { name: input.name, homeDir, osProvision, templateId: input.templateId, scaffold },
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
  }> {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `Project not found: ${id}`, { httpStatus: 404 });
    }
    // Prefer project home under dataDir for chown target when system home differs
    const homeDir = row.home_dir;
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
    // Rewrite plan commands to chown the actual dataDir home
    const commands = [
      `groupadd --system ${row.linux_group} 2>/dev/null || true`,
      `id ${row.linux_user} >/dev/null 2>&1 || useradd --system --gid ${row.linux_group} --home-dir ${homeDir} --create-home --shell /usr/sbin/nologin ${row.linux_user}`,
      `mkdir -p ${homeDir}/app ${homeDir}/logs ${homeDir}/tmp`,
      `chown -R ${row.linux_user}:${row.linux_group} ${homeDir}`,
      `chmod 750 ${homeDir}`,
    ];
    const osProvision = await this.provisionOsUser(commands, row.linux_user, homeDir);
    this.projects.setOsProvisioned(id, osProvision.ok);
    this.audit?.append({
      actor,
      action: 'project.os_provision',
      resource: id,
      detail: { osProvision, plan: commands },
      ok: osProvision.ok,
    });
    return {
      ok: osProvision.ok,
      osProvision,
      requiresExecute: false,
      requiresRoot: false,
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
      const r = await this.host.runCommand(['bash', '-c', cmd], { timeoutMs: 30_000 });
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
    const ok =
      userExists ||
      results.every((x) => x.includes('exit 0') || x.includes('ok-ish'));
    return {
      attempted: true,
      ok: Boolean(ok && homeOk),
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
      throw new YskError(ErrorCodes.NOT_FOUND, `Project not found: ${id}`, { httpStatus: 404 });
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
      throw new YskError(ErrorCodes.NOT_FOUND, `Project not found: ${id}`, { httpStatus: 404 });
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
    // Only delete under dataDir/projects
    const projectsRoot = join(this.dataDir, 'projects');
    if (removeFiles && row.home_dir.startsWith(projectsRoot) && existsSync(row.home_dir)) {
      if (this.host.executeEnabled()) {
        await this.host.deletePath(row.home_dir);
      } else {
        // allow rm of our own dataDir without YSK_EXECUTE for control-plane cleanup
        rmSync(row.home_dir, { recursive: true, force: true });
      }
    }
    if (row.nginx_config_path && existsSync(row.nginx_config_path)) {
      rmSync(row.nginx_config_path, { force: true });
    }
    this.projects.delete(id);
    this.audit?.append({
      actor,
      action: 'project.delete',
      resource: id,
      detail: { home_dir: row.home_dir },
      ok: true,
    });
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
    },
    actor: string,
  ): ProjectDto {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, `Project not found: ${id}`, { httpStatus: 404 });
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
    runtimeVersion: row.runtime_version,
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
  };
}

export { deriveLinuxUser };

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
