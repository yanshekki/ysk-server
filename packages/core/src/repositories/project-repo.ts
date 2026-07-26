import type { YskDatabase } from '../db/database.js';
import type { StoreProject } from '../db/store.js';

export type ProjectRow = StoreProject;

export class ProjectRepository {
  constructor(private readonly db: YskDatabase) {}

  insert(p: ProjectRow): void {
    this.db.snapshot.projects.unshift({ ...p });
    this.db.persist();
  }

  list(): ProjectRow[] {
    return this.db.snapshot.projects.map((p) => ({ ...p }));
  }

  findById(id: string): ProjectRow | undefined {
    const p = this.db.snapshot.projects.find((x) => x.id === id);
    return p ? { ...p } : undefined;
  }

  delete(id: string): boolean {
    const before = this.db.snapshot.projects.length;
    this.db.snapshot.projects = this.db.snapshot.projects.filter((p) => p.id !== id);
    this.db.persist();
    return this.db.snapshot.projects.length < before;
  }

  updateNginxPath(id: string, path: string): void {
    const p = this.db.snapshot.projects.find((x) => x.id === id);
    if (!p) return;
    p.nginx_config_path = path;
    p.updated_at = new Date().toISOString();
    this.db.persist();
  }

  setOsProvisioned(id: string, ok: boolean): void {
    const p = this.db.snapshot.projects.find((x) => x.id === id);
    if (!p) return;
    p.os_provisioned = ok;
    p.status = ok ? 'active' : 'active_pending_os';
    p.updated_at = new Date().toISOString();
    this.db.persist();
  }

  updateMeta(
    id: string,
    patch: Partial<Pick<ProjectRow, 'runtime' | 'runtime_version' | 'domain' | 'name'>>,
  ): void {
    const p = this.db.snapshot.projects.find((x) => x.id === id);
    if (!p) return;
    if (patch.runtime !== undefined) p.runtime = patch.runtime;
    if (patch.runtime_version !== undefined) p.runtime_version = patch.runtime_version;
    if (patch.domain !== undefined) p.domain = patch.domain;
    if (patch.name !== undefined) p.name = patch.name;
    p.updated_at = new Date().toISOString();
    this.db.persist();
  }

  /**
   * Patch runtime / deploy fields after real process ops.
   */
  updateRuntimeState(
    id: string,
    patch: Partial<
      Pick<
        ProjectRow,
        | 'port'
        | 'pid'
        | 'pidfile'
        | 'process_status'
        | 'status'
        | 'nginx_config_path'
        | 'last_health'
        | 'last_deploy_at'
        | 'git_url'
        | 'git_branch'
        | 'git_commit'
        | 'env_vars'
        | 'last_backup_path'
        | 'last_backup_at'
        | 'quota_mb'
        | 'memory_max'
        | 'cpu_quota_percent'
      >
    >,
  ): void {
    const p = this.db.snapshot.projects.find((x) => x.id === id);
    if (!p) return;
    if (patch.port !== undefined) p.port = patch.port;
    if ('pid' in patch) p.pid = patch.pid;
    if (patch.pidfile !== undefined) p.pidfile = patch.pidfile;
    if (patch.process_status !== undefined) p.process_status = patch.process_status;
    if (patch.status !== undefined) p.status = patch.status;
    if (patch.nginx_config_path !== undefined) p.nginx_config_path = patch.nginx_config_path;
    if (patch.last_health !== undefined) p.last_health = patch.last_health;
    if (patch.last_deploy_at !== undefined) p.last_deploy_at = patch.last_deploy_at;
    if (patch.git_url !== undefined) p.git_url = patch.git_url;
    if (patch.git_branch !== undefined) p.git_branch = patch.git_branch;
    if (patch.git_commit !== undefined) p.git_commit = patch.git_commit;
    if (patch.env_vars !== undefined) p.env_vars = patch.env_vars;
    if (patch.last_backup_path !== undefined) p.last_backup_path = patch.last_backup_path;
    if (patch.last_backup_at !== undefined) p.last_backup_at = patch.last_backup_at;
    if (patch.quota_mb !== undefined) p.quota_mb = patch.quota_mb;
    if (patch.memory_max !== undefined) p.memory_max = patch.memory_max;
    if (patch.cpu_quota_percent !== undefined) p.cpu_quota_percent = patch.cpu_quota_percent;
    p.updated_at = new Date().toISOString();
    this.db.persist();
  }
}
