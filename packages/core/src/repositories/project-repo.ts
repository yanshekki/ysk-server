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
}
