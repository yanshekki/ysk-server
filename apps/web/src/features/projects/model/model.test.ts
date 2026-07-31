import { describe, expect, it } from 'vitest';
import type { ProjectDto } from '@ysk/shared';
import {
  buildProjectChecklist,
  deriveProjectStatus,
  formatHealthFacts,
  summarizeProjects,
} from './status';
import {
  actionLabel,
  defaultEnvText,
  envToText,
  formatOpsMessage,
  formatRuntimeLabel,
  parseEnvText,
} from './ops';
import {
  defaultRuntimeInstallVersion,
  loadDeployPrefs,
  runtimeInstallKind,
  runtimePagePath,
  runtimeVersionChoices,
  saveDeployPrefs,
} from './deploy-prefs';
import { formatRuntimeName, getProjectUiProfile } from './runtime-ui';

const base = {
  id: 'p1',
  name: 'Demo',
  runtime: 'node',
} as ProjectDto;

describe('project model/status', () => {
  it('deriveProjectStatus covers buckets', () => {
    expect(deriveProjectStatus({ ...base, status: 'suspended' }).bucket).toBe('stopped');
    expect(deriveProjectStatus({ ...base, processStatus: 'failed' }).tone).toBe('danger');
    expect(deriveProjectStatus({ ...base, status: 'unhealthy' }).bucket).toBe('unhealthy');
    expect(deriveProjectStatus({ ...base, status: 'pending_os' }).bucket).toBe('pending_os');
    expect(deriveProjectStatus({ ...base, status: 'running_degraded' }).bucket).toBe('degraded');
    expect(deriveProjectStatus({ ...base, status: 'deploying' }).tone).toBe('info');
    expect(deriveProjectStatus({ ...base, status: 'published' }).bucket).toBe('running');
    expect(deriveProjectStatus({ ...base, processStatus: 'running' }).bucket).toBe('running');
    expect(deriveProjectStatus({ ...base, processStatus: 'stopped' }).bucket).toBe('stopped');
    expect(deriveProjectStatus({ ...base, status: 'weird' }).bucket).toBeTruthy();
  });

  it('summarizeProjects counts buckets', () => {
    const items = [
      { ...base, processStatus: 'running' },
      { ...base, id: 'p2', processStatus: 'stopped' },
      { ...base, id: 'p3', status: 'failed' },
    ] as ProjectDto[];
    const s = summarizeProjects(items);
    expect(s.total).toBe(3);
    expect(s.running + s.stopped + s.unhealthy + s.degraded + s.pendingOs).toBe(3);
  });

  it('buildProjectChecklist and formatHealthFacts', () => {
    const steps = buildProjectChecklist({
      ...base,
      osProvisioned: true,
      domain: 'x.com',
      lastDeployAt: new Date().toISOString(),
      nginxConfigPath: '/etc/nginx/x',
    } as ProjectDto);
    expect(steps.length).toBeGreaterThan(0);
    expect(formatHealthFacts(null)).toEqual([]);
    expect(
      formatHealthFacts({
        ok: true,
        status: 'up',
        latencyMs: 12,
        processStatus: 'running',
        httpStatus: 200,
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe('project model/ops', () => {
  const t = ((k: string, o?: Record<string, unknown>) => {
    if (o) return `${k}:${JSON.stringify(o)}`;
    return k;
  }) as never;

  it('parseEnvText / envToText / defaultEnvText', () => {
    expect(parseEnvText('A=1\n#c\nB=2\n')).toEqual({ A: '1', B: '2' });
    expect(defaultEnvText('php')).toMatch(/APP_ENV/);
    expect(defaultEnvText('static')).toBe('');
    expect(defaultEnvText('python')).toMatch(/APP_ENV/);
    expect(defaultEnvText('node')).toMatch(/NODE_ENV/);
    expect(envToText({ X: '1' }, 'node')).toContain('X=1');
    expect(envToText(undefined, 'php')).toMatch(/APP_ENV/);
  });

  it('formatOpsMessage and labels', () => {
    expect(actionLabel('deploy', t)).toBeTruthy();
    expect(actionLabel('unknown-action', t)).toBe('unknown-action');
    expect(
      formatOpsMessage('deploy', { ok: true, notes: ['done'], url: 'http://x' } as never, t),
    ).toBeTruthy();
    expect(
      formatOpsMessage(
        'stop',
        { ok: false, notes: [], blockMessage: 'blocked' } as never,
        t,
      ),
    ).toMatch(/opsFail|blocked|stop/i);
    expect(formatRuntimeLabel('node', '20', t)).toBeTruthy();
    expect(formatRuntimeLabel('static', null, t)).toBeTruthy();
  });
});

describe('runtime-ui + deploy-prefs', () => {
  it('profiles and prefs', () => {
    for (const r of ['node', 'php', 'static', 'python', 'go', 'rust'] as const) {
      expect(getProjectUiProfile(r).runtime).toBe(r);
      expect(formatRuntimeName(r).length).toBeGreaterThan(0);
      expect(runtimeVersionChoices(r).length).toBeGreaterThanOrEqual(0);
      if (r !== 'static') {
        expect(defaultRuntimeInstallVersion(r)).toBeTruthy();
        expect(runtimeInstallKind(r)).toBe(r);
        expect(runtimePagePath(r)).toContain(r);
      } else {
        expect(runtimeInstallKind(r)).toBeNull();
        expect(runtimePagePath(r)).toBeNull();
      }
    }
    expect(runtimeInstallKind('other')).toBeNull();
    expect(formatRuntimeName(undefined)).toBeTruthy();
    saveDeployPrefs('px', { entry: 'main.js', skipBuild: true });
    expect(loadDeployPrefs('px').entry).toBe('main.js');
    expect(loadDeployPrefs('missing').skipBuild).toBeFalsy();
  });
});
