import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { ProjectRepository } from './project-repo.js';

describe('ProjectRepository', () => {
  it('inserts, lists, updates runtime state, deletes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-projrepo-'));
    const db = openDatabase(join(dir, 'db.json'));
    const repo = new ProjectRepository(db);
    const now = new Date().toISOString();
    repo.insert({
      id: 'p1',
      name: 'Demo',
      domain: 'demo.local',
      runtime: 'static',
      runtime_version: '',
      linux_user: 'ysk_demo',
      linux_group: 'ysk_demo',
      home_dir: join(dir, 'projects', 'ysk_demo'),
      env: 'production',
      status: 'created',
      process_status: 'stopped',
      os_provisioned: false,
      created_at: now,
      updated_at: now,
    });
    expect(repo.list()).toHaveLength(1);
    expect(repo.findById('p1')?.name).toBe('Demo');
    repo.updateRuntimeState('p1', { process_status: 'running', status: 'published' });
    expect(repo.findById('p1')?.process_status).toBe('running');
    repo.updateNginxPath('p1', '/tmp/x.conf');
    expect(repo.findById('p1')?.nginx_config_path).toBe('/tmp/x.conf');
    repo.updateMeta('p1', { domain: 'new.local' });
    expect(repo.findById('p1')?.domain).toBe('new.local');
    expect(repo.delete('p1')).toBe(true);
    expect(repo.findById('p1')).toBeUndefined();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
