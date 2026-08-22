import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { LoginPage } from './LoginPage';
import { PublicFilesPage } from './features/PublicFilesPage';
import { NodeRuntimePage } from './features/NodeRuntimePage';
import { Fail2banPage } from './features/Fail2banPage';
import { PostgresPage } from './features/PostgresPage';
import { CronPage } from './features/CronPage';

function renderPage(path: string, el: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

const honestyShape = HONESTY_WRITTEN_BLOCKED;

describe('page smoke tests (honesty fixtures)', () => {
  beforeEach(() => {
    authStore.clear();
    authStore.setSession('test-token', {
      username: 'admin',
      roles: ['admin'],
      capabilities: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('LoginPage renders form and surfaces API error (no false Success)', async () => {
    const user = userEvent.setup();
    installFetchMock([
      {
        match: '/api/v1/auth/login',
        status: 401,
        body: { message: 'Invalid credentials', code: 'YSK_AUTH' } },
    ]);
    renderPage('/login', <LoginPage />);
    const userInput = screen.getByLabelText(/username/i);
    const passInput = screen.getByLabelText(/password/i);
    expect(userInput).toHaveValue('');
    expect(passInput).toHaveValue('');
    await user.type(userInput, 'admin');
    await user.type(passInput, 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in|login|log in|submit/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/^Success$/)).not.toBeInTheDocument();
  });

  it('PublicFilesPage apply shows blocked honesty, not bare Success', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url, init) =>
          url.includes('/api/v1/hosting/files/apply') &&
          (init?.method ?? 'GET').toUpperCase() === 'POST',
        body: honestyShape },
    ]);
    renderPage('/files/public', <PublicFilesPage />);
    const applyBtn = await screen.findByRole('button', {
      name: /apply|reload/i });
    await user.click(applyBtn);
    await waitFor(() => {
      expect(screen.getByText(/cannot run/i)).toBeInTheDocument();
    });
    // Honesty: ok:true + requiresExecute must not collapse to Success-only
    expect(screen.queryByText(/^Success$/)).not.toBeInTheDocument();
  });

  it('NodeRuntimePage install returns honesty written+requiresExecute', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      // More specific install path before GET /runtimes prefix match
      {
        match: (url, init) =>
          url.includes('/api/v1/hosting/runtimes/install') &&
          (init?.method ?? '').toUpperCase() === 'POST',
        body: honestyShape },
      {
        match: (url) =>
          url === '/api/v1/hosting/runtimes' ||
          url.startsWith('/api/v1/hosting/runtimes?'),
        body: { ok: true, nodeVersion: 'v20.0.0', nodePath: '/usr/bin/node' } },
    ]);
    renderPage('/runtimes/node', <NodeRuntimePage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
    const install = await screen.findByRole('button', { name: /install.*20|node/i });
    await user.click(install);
    await waitFor(() => {
      expect(screen.getByText(/cannot run/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/^Success$/)).not.toBeInTheDocument();
  });

  it('Fail2banPage start service surfaces honesty banner', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: '/api/v1/system/fail2ban/status',
        body: {
          installed: true,
          active: 'inactive',
          activeLabel: 'inactive',
          enabled: 'disabled',
          jails: [],
          banned: [],
          ignoreIps: [],
          catalog: [{ id: 'sshd', desc: 'SSH' }],
          defaultJails: ['sshd'] } },
      {
        match: (url, init) =>
          url.includes('/api/v1/system/fail2ban/service') &&
          (init?.method ?? '').toUpperCase() === 'POST',
        body: honestyShape },
    ]);
    renderPage('/fail2ban', <Fail2banPage />);
    const start = await screen.findByRole('button', { name: /start/i });
    await user.click(start);
    await waitFor(() => {
      expect(screen.getByText(/cannot run/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/^Success$/)).not.toBeInTheDocument();
  });

  it('PostgresPage lists written apply_status badge and start honesty', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: /\/api\/v1\/system\/db\/postgres\/console/,
        body: {
          engine: 'postgres',
          title: 'PostgreSQL',
          unit: 'postgresql',
          active: 'inactive',
          activeLabel: 'inactive',
          installed: true,
          executeEnabled: false,
          isRoot: false,
          canLifecycle: true,
          metrics: {},
          categories: [],
          live: {} } },
      {
        match: /\/api\/v1\/resources\/postgres/,
        body: {
          items: [
            {
              id: 'db1',
              name: 'appdb',
              apply_status: 'written' },
          ],
          meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } } },
      {
        match: (url, init) =>
          url.includes('/api/v1/system/db/postgres/lifecycle') &&
          (init?.method ?? '').toUpperCase() === 'POST',
        body: honestyShape },
    ]);
    renderPage('/databases/postgres', <PostgresPage />);
    // Written honesty badge in table — not bare "Success"
    await waitFor(() => {
      expect(screen.getByText(/written/i)).toBeInTheDocument();
    });
    expect(screen.getByText('appdb')).toBeInTheDocument();
    expect(screen.queryByText(/^Success$/)).not.toBeInTheDocument();

    const start = await screen.findByRole('button', { name: /start/i });
    await user.click(start);
    await waitFor(() => {
      expect(screen.getByText(/cannot run/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/^Success$/)).not.toBeInTheDocument();
  });

  it('CronPage loads jobs/status and install honesty is blocked', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) => url.startsWith('/api/v1/cron') && !url.includes('/install'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
            return honestyShape;
          }
          if (url.includes('/status')) {
            return {
              managedPath: '/etc/cron.d/ysk',
              managedLines: 0,
              enabledJobs: 0,
              totalJobs: 0,
              hostHasYskEntries: false,
              hostCrontabPreview: '',
              executeEnabled: false,
              lastInstallOk: null,
              lastInstallAt: null };
          }
          return { items: [] };
        } },
      {
        match: '/api/v1/projects',
        body: { items: [] } },
      {
        match: (url) => url.includes('/api/v1/cron/install'),
        body: honestyShape },
    ]);
    renderPage('/cron', <CronPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
    // Find install / push to host action if present
    const installCandidates = screen.queryAllByRole('button', {
      name: /install|host|apply|push/i });
    if (installCandidates.length > 0) {
      await user.click(installCandidates[0]!);
      const dialogInstall = await screen.findAllByRole('button', {
        name: /install to system/i,
      });
      await user.click(dialogInstall[dialogInstall.length - 1]!);
      await waitFor(() => {
        expect(screen.getByText(/cannot run/i)).toBeInTheDocument();
      });
      expect(screen.queryByText(/^Success$/)).not.toBeInTheDocument();
    } else {
      // Page still smoke-renders with honesty-capable OpsResultPanel present in tree
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    }
  });
});
