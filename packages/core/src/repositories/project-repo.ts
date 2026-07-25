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
    p.updated_at = new Date().toISOString();
    this.db.persist();
  }
}
