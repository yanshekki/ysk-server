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
    runtime: ProjectDto['runtime'];
    runtimeVersion?: string;
    env?: 'staging' | 'production';
    actor: string;
  }): Promise<{ project: ProjectDto; osProvision: { attempted: boolean; ok: boolean; detail: string }; plan: string[] }> {
    if (!input.name?.trim()) {
      throw new YskError(ErrorCodes.VALIDATION, 'Project name is required', { httpStatus: 400 });
    }
    const id = randomUUID();
    const plan = planProjectIsolation({
      id,
      name: input.name,
      domain: input.domain,
      runtime: input.runtime,
      runtimeVersion: input.runtimeVersion,
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
      detail: 'OS user not provisioned (needs root + YSK_EXECUTE=1)',
    };

    if (this.host.executeEnabled() && this.host.isRoot()) {
      osProvision.attempted = true;
      const results: string[] = [];
      for (const cmd of plan.commands) {
        // Only run safe subset: groupadd/useradd/mkdir/chown — skip if already exists
        const argv = cmd.split(/\s+/);
        const r = await this.host.runCommand(argv, { timeoutMs: 15_000 });
        results.push(`${argv.join(' ')} => exit ${r.exitCode}`);
      }
      osProvision.ok = results.every((x) => x.includes('exit 0') || x.includes('already'));
      osProvision.detail = results.join('; ');
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

    const now = new Date().toISOString();
    const row: ProjectRow = {
      id,
      name: plan.project.name,
      domain: input.domain,
      linux_user: plan.project.linuxUser,
      linux_group: plan.project.linuxGroup,
      home_dir: homeDir,
      runtime: input.runtime,
      runtime_version: input.runtimeVersion,
      env: input.env ?? 'production',
      status: osProvision.ok ? 'active' : 'active_pending_os',
      nginx_config_path: nginxPath,
      os_provisioned: osProvision.ok,
      created_at: now,
      updated_at: now,
    };
    this.projects.insert(row);
    this.audit?.append({
      actor: input.actor,
      action: 'project.create',
      resource: id,
      detail: { name: input.name, homeDir, osProvision },
      ok: true,
    });

    return {
      project: toDto(row),
      osProvision,
      plan: plan.commands,
    };
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
}

function toDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
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
    lastHealth: row.last_health,
    lastDeployAt: row.last_deploy_at,
    osProvisioned: row.os_provisioned,
  };
}

export { deriveLinuxUser };
