import { describe, expect, it } from 'vitest';
import type { DbCluster, DbClusterMember } from './types.js';
import {
  galeraAddressList,
  planMariadbGalera,
  renderGaleraCnf,
  renderGaleraPlanMarkdown,
  renderPeerApplyScript,
} from './plan-mariadb-galera.js';

function member(
  partial: Partial<DbClusterMember> & { host: string; id?: string },
): DbClusterMember {
  return {
    id: partial.id ?? partial.host,
    role: partial.role ?? 'node',
    host: partial.host,
    port: partial.port ?? 3306,
    label: partial.label,
    access: partial.access ?? 'ssh',
    applyStatus: partial.applyStatus ?? 'none',
  };
}

function galeraCluster(overrides: Partial<DbCluster> = {}): DbCluster {
  return {
    id: 'cl-galera-1',
    name: 'lab-galera',
    engine: 'mariadb',
    kind: 'mariadb-galera',
    status: 'draft',
    members: [
      member({ id: 'm1', host: '10.0.0.1', access: 'local', label: 'node-a' }),
      member({ id: 'm2', host: '10.0.0.2', access: 'ssh', label: 'node-b' }),
      member({ id: 'm3', host: '10.0.0.3', access: 'ssh', role: 'arbiter' }),
    ],
    params: {},
    notes: [],
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('plan-mariadb-galera pure', () => {
  it('builds gcomm address list with default and custom galera port', () => {
    const c = galeraCluster();
    expect(galeraAddressList(c)).toBe('10.0.0.1:4567,10.0.0.2:4567,10.0.0.3:4567');
    const custom = galeraCluster({ params: { galeraPort: 4568 } });
    expect(galeraAddressList(custom)).toContain(':4568');
    expect(galeraAddressList(custom)).not.toContain(':4567');
  });

  it('falls back invalid galeraPort to 4567', () => {
    const c = galeraCluster({ params: { galeraPort: 0 } });
    expect(galeraAddressList(c)).toContain(':4567');
    const bad = galeraCluster({ params: { galeraPort: 99999 } });
    expect(galeraAddressList(bad)).toContain(':4567');
  });

  it('renders cnf with sanitized cluster name, sst method, and node identity', () => {
    const c = galeraCluster({
      name: 'Weird Name!!',
      params: { clusterName: 'ysk@lab#1', sstMethod: 'mariabackup' },
    });
    const cnf = renderGaleraCnf(c, '10.0.0.1');
    expect(cnf).toContain('wsrep_on=ON');
    expect(cnf).toContain('wsrep_cluster_name="ysk-lab-1"');
    expect(cnf).toContain('wsrep_node_name="node-a"');
    expect(cnf).toContain('wsrep_node_address="10.0.0.1"');
    expect(cnf).toContain('wsrep_sst_method=mariabackup');
    expect(cnf).toContain('gcomm://10.0.0.1:4567');
  });

  it('uses rsync only when sstMethod is exactly rsync', () => {
    const rsync = renderGaleraCnf(galeraCluster({ params: { sstMethod: 'rsync' } }), '10.0.0.1');
    expect(rsync).toContain('wsrep_sst_method=rsync');
    const other = renderGaleraCnf(galeraCluster({ params: { sstMethod: 'xtrabackup' } }), '10.0.0.1');
    expect(other).toContain('wsrep_sst_method=mariabackup');
  });

  it('falls back to first member when thisHost is unknown', () => {
    const cnf = renderGaleraCnf(galeraCluster(), '198.51.100.99');
    expect(cnf).toContain('wsrep_node_name="node-a"');
    expect(cnf).toContain('wsrep_node_address="198.51.100.99"');
  });

  it('renders plan markdown and peer-apply script with honesty markers', () => {
    const c = galeraCluster({ params: { sstMethod: 'rsync', galeraPort: 4567 } });
    const md = renderGaleraPlanMarkdown(c);
    expect(md).toContain('# MariaDB Galera plan');
    expect(md).toContain(c.id);
    expect(md).toContain('10.0.0.1');
    expect(md).toContain('galera_new_cluster');
    expect(md).toMatch(/Honesty|honest/i);

    const sh = renderPeerApplyScript(c);
    expect(sh.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(sh).toContain(c.id);
    expect(sh).toContain('99-ysk-galera.cnf');
    expect(sh).toContain('galera_new_cluster');
  });

  it('plans successfully with conf steps, peer files, bootstrap and probe', () => {
    const plan = planMariadbGalera(galeraCluster());
    expect(plan.ok).toBe(true);
    expect(plan.dryRun).toBe(true);
    expect(plan.requiresExecute).toBe(true);
    expect(plan.requiresRoot).toBe(true);
    expect(plan.clusterId).toBe('cl-galera-1');
    expect(plan.files.map((f) => f.relativePath)).toEqual(
      expect.arrayContaining([
        'conf/99-ysk-galera.cnf',
        'plan.md',
        'scripts/peer-apply.sh',
        'conf/peers/10.0.0.2.cnf',
        'conf/peers/10.0.0.3.cnf',
      ]),
    );
    expect(plan.steps.some((s) => s.id === 'bootstrap' && s.kind === 'command')).toBe(true);
    expect(plan.steps.some((s) => s.id === 'probe' && s.kind === 'probe')).toBe(true);
    expect(plan.steps.filter((s) => s.kind === 'manual').length).toBeGreaterThanOrEqual(2);
    expect(plan.notes.some((n) => n.includes('gcomm://'))).toBe(true);
  });

  it('notes when fewer than 2 members but still ok', () => {
    const plan = planMariadbGalera(
      galeraCluster({
        members: [member({ id: 'solo', host: '10.9.0.1', access: 'local' })],
      }),
    );
    expect(plan.ok).toBe(true);
    expect(plan.notes.length).toBeGreaterThan(0);
    expect(plan.steps.some((s) => s.id === 'bootstrap')).toBe(true);
  });

  it('rejects wrong engine or kind', () => {
    const wrongEngine = planMariadbGalera(galeraCluster({ engine: 'mysql' }));
    expect(wrongEngine.ok).toBe(false);
    expect(wrongEngine.steps).toHaveLength(0);
    expect(wrongEngine.files).toHaveLength(0);
    expect(wrongEngine.notes.length).toBeGreaterThan(0);

    const wrongKind = planMariadbGalera(
      galeraCluster({ kind: 'mysql-replica', engine: 'mariadb' }),
    );
    expect(wrongKind.ok).toBe(false);
  });
});
