import { describe, expect, it } from 'vitest';
import {
  buildProjectIsolationReadinessItems,
  listIsolationReport,
  planIsolationMigration,
} from './project-isolation-status.js';
import { projectHomeDir } from './project.js';

const ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('project isolation status', () => {
  it('flags non-canonical home as needs migration', () => {
    const plan = planIsolationMigration({
      id: ID,
      name: 'Legacy',
      linuxUser: 'ysk_legacy',
      homeDir: '/var/lib/ysk-server/projects/ysk_legacy',
      osProvisioned: true,
    });
    expect(plan.needsMigration).toBe(true);
    expect(plan.targetHome).toBe(projectHomeDir(ID));
    expect(plan.legacyUserName).toBe(true);
    expect(plan.homeIsCanonical).toBe(false);
  });

  it('canonical provisioned home is fine', () => {
    const home = projectHomeDir(ID);
    const plan = planIsolationMigration({
      id: ID,
      name: 'New',
      linuxUser: 'ysks_a1b2c3d4e5f6',
      homeDir: home,
      osProvisioned: true,
    });
    // home may not exist on disk → needsMigration can still be true for missing dir
    expect(plan.homeIsCanonical).toBe(true);
    expect(plan.targetHome).toBe(home);
  });

  it('listIsolationReport summarizes needsMigration and missingOwner', () => {
    const { items, summary } = listIsolationReport([
      {
        id: ID,
        name: 'A',
        linuxUser: 'ysks_a1b2c3d4e5f6',
        homeDir: projectHomeDir(ID),
        osProvisioned: false,
      },
      {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'B',
        linuxUser: 'ysks_111111111111',
        homeDir: projectHomeDir('11111111-1111-1111-1111-111111111111'),
        osProvisioned: true,
        ownerUserId: 'u1',
      },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.unprovisioned).toBe(1);
    expect(summary.missingOwner).toBeGreaterThanOrEqual(1);
    expect(items.find((i) => i.projectId === ID)?.needsMigration).toBe(true);
  });

  it('readiness summary lists unprovisioned projects', () => {
    const items = buildProjectIsolationReadinessItems([
      {
        id: ID,
        name: 'A',
        linuxUser: 'ysks_a1b2c3d4e5f6',
        homeDir: projectHomeDir(ID),
        osProvisioned: false,
      },
      {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'B',
        linuxUser: 'ysks_111111111111',
        homeDir: projectHomeDir('11111111-1111-1111-1111-111111111111'),
        osProvisioned: true,
      },
    ]);
    const summary = items.find((i) => i.id === 'projects-isolation-summary');
    expect(summary).toBeTruthy();
    expect(summary!.level).toBe('missing');
    expect(summary!.detail).toMatch(/未隔離 1/);
  });
});
