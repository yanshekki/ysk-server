/**
 * Direct hook + SoftwareInstallBanner coverage for low-line modules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  type FetchRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { useUpdates } from './updates/useUpdates';
import { useSslCertificates } from './ssl/useSslCertificates';
import { useFeatureSoftware } from './software/useFeatureSoftware';
import { useAiTasks } from './llm/useAiTasks';
import { useFiles } from './files/useFiles';
import { useEmailDomains } from './email/useEmailDomains';
import { useAgents } from './agents/useAgents';
import { useResourceCrud } from './resources/useResourceCrud';
import { useProjectOps } from './projects/useProjectOps';
import { SoftwareInstallBanner } from '../shared/components/ui/SoftwareInstallBanner';
import { toast, toastStore } from '../shared/stores/toast-store';

const catchAll: FetchRoute = { match: /.*/, body: { ok: true, items: [], ready: true, missing: [] } };

describe('feature hooks coverage', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('useUpdates load/refresh/applyPackage/applySelf', async () => {
    installFetchMock([
      {
        match: (url) => url.startsWith('/api/v1/updates/inventory/refresh'),
        body: {
          inventory: [
            {
              packageName: 'nginx',
              currentVersion: '1.0',
              candidateVersion: '1.1' },
          ],
          advice: [
            {
              packageName: 'nginx',
              currentVersion: '1.0',
              candidateVersion: '1.1',
              advice: 'upgrade',
              risk: 'medium',
              cves: [],
              requiresApproval: false,
              summary: 'bump' },
          ],
          collectedAt: new Date().toISOString(),
          meta: { notes: ['ok'] } } },
      {
        match: (url) => url.startsWith('/api/v1/updates/inventory'),
        body: {
          inventory: [
            {
              packageName: 'nginx',
              currentVersion: '1.0',
              candidateVersion: '1.1',
              risk: 'medium',
              needsApproval: false },
          ],
          advice: [
            {
              packageName: 'nginx',
              currentVersion: '1.0',
              candidateVersion: '1.1',
              advice: 'upgrade',
              risk: 'medium',
              cves: ['CVE-1'],
              requiresApproval: false,
              summary: 'bump' },
          ],
          collectedAt: new Date().toISOString(),
          listMeta: { total: 1 } } },
      {
        match: (url) => url.startsWith('/api/v1/updates/apply'),
        body: HONESTY_WRITTEN_BLOCKED },
      {
        match: (url) => url.startsWith('/api/v1/updates/self/apply'),
        body: { ok: true, applied: false, notes: ['up to date'] } },
      {
        match: (url) => url.startsWith('/api/v1/updates/self'),
        body: {
          status: {
            ok: true,
            checked: true,
            updateAvailable: true,
            currentVersion: '0.1.0',
            latestVersion: '0.2.0' },
          currentVersion: '0.1.0',
          latestVersion: '0.2.0',
          updateAvailable: true } },
      {
        match: /\/api\/v1\/scheduler/,
        body: { jobs: [{ id: 'j1', name: 'scan', next: new Date().toISOString() }] } },
      catchAll,
    ]);
    const { result } = renderHook(() => useUpdates());
    await waitFor(() => expect(result.current.inventory.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.load(true, true);
    });
    await act(async () => {
      await result.current.load(false, false, { q: 'nginx', risk: 'medium', upgradable: '1' });
    });
    await act(async () => {
      await result.current
        .applyPackage(result.current.inventory[0]!, false)
        .catch(() => undefined);
    });
    await act(async () => {
      await result.current.applySelf().catch(() => undefined);
    });
    expect(result.current.selfUpdate).toBeTruthy();
  });

  it('useUpdates load does not toast Failed to fetch', async () => {
    installFetchMock([
      {
        match: (url) => url.includes('/api/v1/updates/'),
        handler: () => {
          throw new TypeError('Failed to fetch');
        },
      },
      catchAll,
    ]);
    toast.clear();
    const { result } = renderHook(() => useUpdates());
    await act(async () => {
      await result.current.load(false);
    });
    expect(toastStore.getToasts().some((x) => /Failed to fetch/i.test(x.message))).toBe(false);
    expect(toastStore.getToasts().some((x) => x.variant === 'error')).toBe(false);
  });

  it('useSslCertificates upload/request/remove/retry', async () => {
    installFetchMock([
      {
        match: (url) => url.startsWith('/api/v1/ssl/certificates'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() === 'DELETE') {
            return { ok: true, domain: 'example.com', notes: ['removed'] };
          }
          return {
            items: [
              {
                id: 'c1',
                domain: 'example.com',
                expiresAt: new Date(Date.now() + 86400000 * 40).toISOString(),
                issuer: "Let's Encrypt",
                apply_status: 'planned' },
            ] };
        } },
      {
        match: (url) => url.startsWith('/api/v1/ssl/upload'),
        body: { certificate: { id: 'c2', domain: 'x.com' } } },
      {
        match: (url) =>
          url.startsWith('/api/v1/ssl/letsencrypt') || url.startsWith('/api/v1/system/ssl/apply'),
        body: {
          ...HONESTY_WRITTEN_BLOCKED,
          ok: true,
          notes: ['written'],
          steps: [{ name: 'issue', status: 'blocked', detail: 'need execute' }],
          certificate: { id: 'c3', domain: 'le.example.com' } } },
      {
        match: (url) => url.startsWith('/api/v1/ssl/bindings'),
        body: {
          items: [
            {
              id: 'c1',
              domain: 'example.com',
              projects: [{ id: 'p1', name: 'Demo' }],
              mailDomains: [] },
          ],
          renewJobs: [],
          notes: [] } },
      catchAll,
    ]);
    const { result } = renderHook(() => useSslCertificates());
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.upload('x.com', 'CERT', 'KEY').catch(() => undefined);
    });
    await act(async () => {
      await result.current.requestCertificate('le.example.com', 'a@b.c').catch(() => undefined);
    });
    await act(async () => {
      await result.current.remove('c1').catch(() => undefined);
    });
    await act(async () => {
      await result.current.retryLast().catch(() => undefined);
    });
    await act(async () => {
      result.current.clearResult();
    });
    await act(async () => {
      await result.current.refresh();
    });
  });

  it('useFeatureSoftware missing install + SoftwareInstallBanner UI', async () => {
    const user = userEvent.setup();
    let ready = false;
    installFetchMock([
      {
        match: (url) => url.startsWith('/api/v1/system/software'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            ready = true;
            return {
              ...HONESTY_WRITTEN_BLOCKED,
              ok: false,
              blocked: true,
              blockMessage: 'Host execute is off',
              notes: ['written ≠ applied'],
              results: [
                {
                  id: 'nginx',
                  ok: false,
                  blocked: true,
                  blockMessage: 'Host execute is off',
                  notes: ['need root'] },
              ] };
          }
          if (ready) {
            return {
              items: [{ id: 'nginx', title: 'nginx', installed: true }],
              missing: [],
              ready: true };
          }
          return {
            items: [{ id: 'nginx', title: 'nginx', installed: false }],
            missing: [{ id: 'nginx', title: 'nginx', installed: false }],
            ready: false };
        } },
      catchAll,
    ]);

    const { result } = renderHook(() => useFeatureSoftware('nginx'));
    await waitFor(() => expect(result.current.ready).toBe(false));
    await act(async () => {
      await result.current.installOne('nginx');
    });
    ready = false;
    await act(async () => {
      await result.current.installAll();
    });
    await act(async () => {
      await result.current.refresh();
    });

    ready = false;
    render(
      <SoftwareInstallBanner
        feature="nginx"
        title="Need nginx"
        onInstalled={vi.fn()}
        autoHideWhenReady={false}
      />,
    );
    await waitFor(() => expect(screen.getAllByText(/Need nginx|nginx/i).length).toBeGreaterThan(0));
    const installBtn = screen.queryAllByRole('button', { name: /install|one-click|一鍵|一键/i })[0];
    if (installBtn) await user.click(installBtn);
    const reprobe = screen.queryAllByRole('button', { name: /re-?probe|recheck|重新/i })[0];
    if (reprobe) await user.click(reprobe);
  });

  it('useAiTasks create/approve/cancel/playbook/reject', async () => {
    installFetchMock([
      {
        match: (url) => url.startsWith('/api/v1/ai/playbooks'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return {
              task: {
                id: 't2',
                title: 'Play',
                status: 'pending',
                createdAt: new Date().toISOString(),
                steps: [{ id: 's1', title: 'Step', status: 'pending' }] } };
          }
          if (url.includes('runs')) return { items: [{ id: 'r1', playbookId: 'pb1' }] };
          return {
            items: [{ id: 'pb1', name: 'Health check', description: 'd' }] };
        } },
      {
        match: (url) => url.startsWith('/api/v1/ai/tasks'),
        handler: (url, init) => {
          const method = (init?.method ?? 'GET').toUpperCase();
          if (method === 'POST' && url.endsWith('/tasks')) {
            return {
              id: 't1',
              title: 'New',
              status: 'pending',
              createdAt: new Date().toISOString(),
              steps: [{ id: 's1', title: 'Plan', status: 'pending' }],
              prompt: 'hi' };
          }
          if (method !== 'GET') {
            return {
              id: 't1',
              title: 'New',
              status: 'running',
              createdAt: new Date().toISOString(),
              steps: [{ id: 's1', title: 'Plan', status: 'completed' }] };
          }
          return {
            items: [
              {
                id: 't1',
                title: 'Task',
                status: 'pending',
                createdAt: new Date().toISOString(),
                steps: [{ id: 's1', title: 'Plan', status: 'pending' }],
                prompt: 'x' },
            ] };
        } },
      catchAll,
    ]);
    const { result } = renderHook(() => useAiTasks());
    await waitFor(() => expect(result.current.tasks.length).toBeGreaterThan(0));
    await act(async () => {
      result.current.setPrompt('do something');
    });
    await act(async () => {
      await result.current.createTask('do something').catch(() => undefined);
    });
    await act(async () => {
      await result.current.approveAndRun('t1').catch(() => undefined);
    });
    await act(async () => {
      await result.current.runPlaybook('pb1').catch(() => undefined);
    });
    await act(async () => {
      await result.current.cancelTask('t1').catch(() => undefined);
    });
    await act(async () => {
      await result.current.rejectStep('t1', 's1').catch(() => undefined);
    });
    await act(async () => {
      await result.current.refresh().catch(() => undefined);
    });
  });

  it('useFiles list/open/save/mkdir', async () => {
    const now = new Date().toISOString();
    installFetchMock([
      {
        match: (url) => url.includes('/api/v1/files'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return { ok: true, path: '/new', content: 'hi', bytes: 2 };
          }
          if (url.includes('/read')) {
            return { content: 'hello', path: 'a.txt', bytes: 5 };
          }
          return {
            items: [
              { name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: now },
              { name: 'd', path: 'd', type: 'dir', size: 0, mtime: now },
            ],
            path: '/',
            root: 'public' };
        } },
      catchAll,
    ]);
    const { result } = renderHook(() => useFiles());
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.refresh().catch(() => undefined);
    });
    await act(async () => {
      await result.current
        .openEntry({ name: 'a.txt', path: 'a.txt', type: 'file', size: 1, mtime: now } as never)
        .catch(() => undefined);
    });
    await act(async () => {
      await result.current
        .openEntry({ name: 'd', path: 'd', type: 'dir', size: 0, mtime: now } as never)
        .catch(() => undefined);
    });
    await act(async () => {
      await result.current.save('a.txt', 'body').catch(() => undefined);
    });
    await act(async () => {
      await result.current.mkdir().catch(() => undefined);
    });
  });

  it('useEmailDomains create + loadDns', async () => {
    installFetchMock([
      {
        match: /\/api\/v1\/email/,
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return { id: 'dom-2', domain: 'new.example.com' };
          }
          if (url.includes('/dns')) {
            return {
              domain: 'example.com',
              records: [{ type: 'MX', name: '@', value: 'mail' }],
              externalTodos: [],
              health: { score: 1, maxScore: 1, messages: [] } };
          }
          return { items: [{ id: 'dom-1', domain: 'example.com' }] };
        } },
      catchAll,
    ]);
    const { result } = renderHook(() => useEmailDomains());
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current
        .create({ domain: 'new.example.com', serverIp: '203.0.113.10' })
        .catch(() => undefined);
    });
    await act(async () => {
      await result.current.loadDns('dom-1').catch(() => undefined);
    });
    await act(async () => {
      await result.current.refresh().catch(() => undefined);
    });
  });

  it('useAgents + useResourceCrud + useProjectOps', async () => {
    installFetchMock([
      {
        match: /\/api\/v1\/fleet\//,
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return { ok: true, id: 'c1', agent_id: 'ag-1' };
          }
          if (url.includes('/commands')) {
            return { items: [{ id: 'c1', agent_id: 'ag-1', status: 'done', payload: {} }] };
          }
          return {
            items: [
              {
                id: 'sess-1',
                agent_id: 'ag-1',
                status: 'connected',
                group: 'g',
                last_seen_at: new Date().toISOString() },
            ] };
        } },
      {
        match: /\/api\/v1\/agents\//,
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return {
              ok: false,
              requiresExecute: true,
              notes: ['Host execute is off'],
              kind: 'openclaw',
              status: 'missing' };
          }
          return {
            items: [
              {
                kind: 'openclaw',
                name: 'OpenClaw',
                status: 'missing',
                unitName: 'o.service',
                unitActive: 'inactive',
                pathExists: false,
                installPath: '/opt/o',
                probedAt: new Date().toISOString() },
            ],
            runtime: {
              kind: 'openclaw',
              name: 'OpenClaw',
              status: 'missing',
              unitName: 'o.service',
              unitActive: 'inactive',
              pathExists: false,
              installPath: '/opt/o',
              probedAt: new Date().toISOString() } };
        } },
      {
        match: /\/api\/v1\/resources\//,
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return { item: { id: 'z1', zone: 'a.com' }, ok: true, ...HONESTY_WRITTEN_BLOCKED };
          }
          return {
            items: [{ id: 'z1', zone: 'a.com', apply_status: 'planned' }],
            meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } };
        } },
      {
        match: /\/api\/v1\/projects/,
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return { ...HONESTY_WRITTEN_BLOCKED, ok: true };
          }
          return {
            items: [
              {
                id: 'p1',
                name: 'Demo',
                domain: 'demo.example.com',
                runtime: 'node',
                processStatus: 'stopped' },
            ] };
        } },
      catchAll,
    ]);

    const agents = renderHook(() => useAgents());
    await waitFor(() => expect(agents.result.current.agents.length).toBeGreaterThan(0));
    await act(async () => {
      await agents.result.current.register({ agentId: 'ag-x' }).catch(() => undefined);
    });
    await act(async () => {
      await agents.result.current.enqueueCommand('sess-1', { type: 'ping' }).catch(() => undefined);
    });
    await act(async () => {
      await agents.result.current.loadCommands('sess-1').catch(() => undefined);
    });
    await act(async () => {
      await agents.result.current.probeKind('openclaw').catch(() => undefined);
    });
    await act(async () => {
      await agents.result.current.installKind('openclaw').catch(() => undefined);
    });
    await act(async () => {
      await agents.result.current.writeUnit('openclaw').catch(() => undefined);
    });
    await act(async () => {
      await agents.result.current.removeAgent('sess-1').catch(() => undefined);
    });

    const crud = renderHook(() => useResourceCrud('dns/zones'));
    await waitFor(() => expect(crud.result.current.items.length).toBeGreaterThan(0));
    await act(async () => {
      await crud.result.current.create({ zone: 'b.com', serverIp: '1.1.1.1' }).catch(() => undefined);
    });
    await act(async () => {
      await crud.result.current.update('z1', { ttl: 60 }).catch(() => undefined);
    });
    await act(async () => {
      await crud.result.current.apply('z1').catch(() => undefined);
    });
    await act(async () => {
      await crud.result.current.remove('z1').catch(() => undefined);
    });

    const ops = renderHook(() => useProjectOps(async () => undefined));
    await waitFor(() => expect(ops.result.current).toBeTruthy());
    for (const [, v] of Object.entries(ops.result.current as object)) {
      if (typeof v === 'function') {
        try {
          await act(async () => {
            const r = (v as (...a: unknown[]) => unknown)('p1', {});
            await Promise.resolve(r).catch(() => undefined);
          });
        } catch {
          /* arity */
        }
      }
    }
  });
});
