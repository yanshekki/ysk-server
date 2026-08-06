import { describe, expect, it } from 'vitest';
import { filterPm2Rows } from './RuntimePm2Panel';
import type { Pm2AppRow } from '../pm2/api';
import { runtimeTabsForKind } from '../../pages/features/GenericRuntimePage';

function row(partial: Partial<Pm2AppRow> & { name: string }): Pm2AppRow {
  return {
    pmId: 0,
    pid: 1,
    status: 'online',
    cpu: 0,
    memory: 0,
    restarts: 0,
    unstableRestarts: 0,
    pmUptime: Date.now(),
    mode: 'fork',
    instances: 1,
    script: 'a.js',
    cwd: '/x',
    interpreter: 'node',
    nodeArgs: '',
    port: '',
    watching: false,
    yskManaged: partial.name.startsWith('ysk-'),
    raw: {},
    ...partial,
  };
}

describe('RuntimePm2Panel helpers', () => {
  it('filterPm2Rows yskOnly and query', () => {
    const apps = [row({ name: 'ysk-a' }), row({ name: 'other', status: 'stopped' })];
    expect(filterPm2Rows(apps, { yskOnly: true, q: '' })).toHaveLength(1);
    expect(filterPm2Rows(apps, { yskOnly: false, q: 'stopped' })).toHaveLength(1);
  });

  it('runtimeTabsForKind only node/bun get processes', () => {
    expect(runtimeTabsForKind('node')).toContain('processes');
    expect(runtimeTabsForKind('bun')).toContain('processes');
    expect(runtimeTabsForKind('python')).not.toContain('processes');
    expect(runtimeTabsForKind('php')).not.toContain('processes');
  });
});
