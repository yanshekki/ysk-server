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
    patch: Partial<
      Pick<
        ProjectRow,
        | 'runtime'
        | 'runtime_version'
        | 'domain'
        | 'domain_aliases'
        | 'name'
        | 'force_https'
        | 'hsts'
        | 'site_redirect_url'
        | 'http_auth_user'
        | 'http_auth_pass'
        | 'doc_root'
        | 'bind_ip'
        | 'real_ip_provider'
        | 'preferred_port'
        | 'status'
        | 'home_dir'
        | 'linux_user'
        | 'linux_group'
        | 'log_extra_dirs'
      >
    >,
  ): void {
    const p = this.db.snapshot.projects.find((x) => x.id === id);
    if (!p) return;
    if (patch.runtime !== undefined) p.runtime = patch.runtime;
    if (patch.runtime_version !== undefined) p.runtime_version = patch.runtime_version;
    if (patch.domain !== undefined) p.domain = patch.domain;
    if (patch.domain_aliases !== undefined) p.domain_aliases = patch.domain_aliases;
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.force_https !== undefined) p.force_https = patch.force_https;
    if (patch.hsts !== undefined) p.hsts = patch.hsts;
    if ('site_redirect_url' in patch) p.site_redirect_url = patch.site_redirect_url;
    if ('http_auth_user' in patch) p.http_auth_user = patch.http_auth_user;
    if ('http_auth_pass' in patch) p.http_auth_pass = patch.http_auth_pass;
    if ('doc_root' in patch) p.doc_root = patch.doc_root;
    if ('bind_ip' in patch) p.bind_ip = patch.bind_ip;
    if ('real_ip_provider' in patch) p.real_ip_provider = patch.real_ip_provider;
    if ('preferred_port' in patch) p.preferred_port = patch.preferred_port;
    if (patch.status !== undefined) p.status = patch.status;
    if (patch.home_dir !== undefined) p.home_dir = patch.home_dir;
    if (patch.linux_user !== undefined) p.linux_user = patch.linux_user;
    if (patch.linux_group !== undefined) p.linux_group = patch.linux_group;
    if ('log_extra_dirs' in patch) p.log_extra_dirs = patch.log_extra_dirs;
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
        | 'git_shallow'
        | 'git_last_error'
        | 'git_auth_kind'
        | 'git_identity_id'
        | 'git_hook_enabled'
        | 'env_vars'
        | 'last_backup_path'
        | 'last_backup_at'
        | 'quota_mb'
        | 'memory_max'
        | 'cpu_quota_percent'
        | 'tasks_max'
        | 'limit_nofile'
        | 'shell'
        | 'account_locked'
        | 'deploy_entry'
        | 'runtime_bin'
        | 'last_deploy_notes'
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
    if (patch.git_shallow !== undefined) p.git_shallow = patch.git_shallow;
    if ('git_last_error' in patch) p.git_last_error = patch.git_last_error;
    if (patch.git_auth_kind !== undefined) p.git_auth_kind = patch.git_auth_kind;
    if ('git_identity_id' in patch) p.git_identity_id = patch.git_identity_id;
    if (patch.git_hook_enabled !== undefined) p.git_hook_enabled = patch.git_hook_enabled;
    if (patch.env_vars !== undefined) p.env_vars = patch.env_vars;
    if (patch.last_backup_path !== undefined) p.last_backup_path = patch.last_backup_path;
    if (patch.last_backup_at !== undefined) p.last_backup_at = patch.last_backup_at;
    if (patch.quota_mb !== undefined) p.quota_mb = patch.quota_mb;
    if (patch.memory_max !== undefined) p.memory_max = patch.memory_max;
    if (patch.cpu_quota_percent !== undefined) p.cpu_quota_percent = patch.cpu_quota_percent;
    if (patch.tasks_max !== undefined) p.tasks_max = patch.tasks_max;
    if (patch.limit_nofile !== undefined) p.limit_nofile = patch.limit_nofile;
    if (patch.shell !== undefined) p.shell = patch.shell;
    if (patch.account_locked !== undefined) p.account_locked = patch.account_locked;
    if ('deploy_entry' in patch) p.deploy_entry = patch.deploy_entry;
    if (patch.runtime_bin !== undefined) p.runtime_bin = patch.runtime_bin;
    if (patch.last_deploy_notes !== undefined) p.last_deploy_notes = patch.last_deploy_notes;
    p.updated_at = new Date().toISOString();
    this.db.persist();
  }
}
