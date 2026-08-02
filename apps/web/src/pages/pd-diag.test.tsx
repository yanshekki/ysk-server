import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installFetchMock, softwareReadyRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { ProjectDetailPage } from './ProjectDetailPage';
import { projectsApi } from '../features/projects';

const t = new Date().toISOString();
const project = {
  id: 'p1', name: 'demo', domain: 'demo.local.test', runtime: 'node', runtimeVersion: '20',
  status: 'running', processStatus: 'running', osProvisioned: true, linuxUser: 'demo',
  homeDir: '/home/ysk/demo', apply_status: 'applied', gitUrl: 'https://github.com/ex/demo.git',
  branch: 'main', entry: 'server.js', envText: 'NODE_ENV=production',
  envVars: { NODE_ENV: 'production' }, env: 'NODE_ENV=production',
  process: { status: 'running', pid: 1 }, nginxConfigPath: '/x', quotaMb: 1024, memoryMax: '512M',
  cpuQuotaPercent: 100, logExtraDirs: ['/var/log/app'], lastDeployAt: t,
  lastHealth: { ok: true, status: 'ok', latencyMs: 12 }, suspended: false, forceHttps: false, hsts: false,
  docRoot: '', bindIp: '', deployEntry: 'server.js',
};

describe('pd', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'], capabilities: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); authStore.clear(); });
  it('list works', async () => {
    const mock = installFetchMock([
      softwareReadyRoute(),
      { match: (u) => u.includes('/auth/me'), body: { user: { username: 'admin', roles: ['admin'] }, capabilities: [] } },
      {
        match: (u) => u.includes('/projects'),
        handler: (u, init) => {
          console.log('FETCH', (init?.method||'GET'), u);
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return { ok: true, notes: ['ok'], project };
          if (/\/projects\/?(\?|$)/.test(u) || (u.includes('/projects') && !/\/projects\/[^/?]+/.test(u))) {
            return { items: [project], total: 1, meta: { total: 1 } };
          }
          return project;
        },
      },
      { match: () => true, body: { ok: true, items: [], missing: [], ready: true } },
    ]);
    const list = await projectsApi.list();
    console.log('LIST', JSON.stringify(list).slice(0,200));
    expect(list.items?.length).toBe(1);

    render(
      <MemoryRouter initialEntries={['/projects/p1?tab=overview&fresh=1']}>
        <Routes><Route path="/projects/:id" element={<ProjectDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.body.innerText).toMatch(/demo/i), { timeout: 8000 });
    console.log('BTNS', Array.from(document.querySelectorAll('button')).map(b => (b.textContent||'').trim()).filter(Boolean).slice(0,30));
    for (const re of [/health/i, /publish/i, /backup/i, /stop/i, /refresh/i]) {
      screen.queryAllByRole('button', { name: re }).forEach(b => fireEvent.click(b));
    }
    await new Promise(r => setTimeout(r, 80));
    expect(mock).toHaveBeenCalled();
  });
});
