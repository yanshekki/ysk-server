import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { authStore } from '../../shared/stores/auth-store';
import { DockerPage } from './DockerPage';

const notInstalledStatus = {
  installed: false,
  daemonActive: false,
  composeAvailable: false,
  version: null,
  composeVersion: null,
  dataRoot: null,
  rootless: false,
  cgroupDriver: null,
  notes: [],
  counts: { containers: 0, running: 0, images: 0, volumes: 0, networks: 0 },
  disk: { dataRoot: null, usedBytes: null, availBytes: null, usePct: null },
  validatorProjects: 0,
};

const installedStatus = {
  ...notInstalledStatus,
  installed: true,
  daemonActive: true,
  composeAvailable: true,
  version: '27.0.3',
  composeVersion: '2.29.1',
  dataRoot: '/var/lib/docker',
  cgroupDriver: 'systemd',
  counts: { containers: 1, running: 1, images: 2, volumes: 1, networks: 3 },
  disk: { dataRoot: '/var/lib/docker', usedBytes: 12 * 1024 ** 3, availBytes: 80 * 1024 ** 3, usePct: 13 },
  validatorProjects: 1,
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DockerPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    authStore.setSession('tok', { username: 'admin', roles: ['admin'] });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/docker') || url.includes('/api/v1/docker?')) {
        return json({ ok: true, status: notInstalledStatus });
      }
      if (url.includes('/api/v1/docker/')) {
        return json({ ok: true, items: [], daemon: { path: '/etc/docker/daemon.json', exists: false } });
      }
      if (url.includes('/api/v1/software')) {
        return json({
          ok: true,
          items: [{ id: 'docker', title: 'Docker', installed: false }],
          missing: [{ id: 'docker', title: 'Docker Engine' }],
          ready: false,
        });
      }
      return json({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('renders overview and can open about tab when engine is missing', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DockerPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^docker$/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('tab', { name: /containers/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/not installed/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/what this page does/i)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /about/i }));
    await waitFor(() => {
      expect(screen.getByText(/install and control docker engine/i)).toBeInTheDocument();
    });
  });

  it('shows engine tabs and selection-first prune / pull when installed', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/docker') || url.includes('/api/v1/docker?')) {
        return json({ ok: true, status: installedStatus });
      }
      if (url.includes('/api/v1/docker/volumes')) {
        return json({ ok: true, items: [{ name: 'data', driver: 'local' }] });
      }
      if (url.includes('/api/v1/docker/networks')) {
        return json({
          ok: true,
          items: [{ id: '1', name: 'bridge', driver: 'bridge', protected: true }],
        });
      }
      if (url.includes('/api/v1/docker/df')) {
        return json({
          ok: true,
          items: [{ type: 'Images', total: '2', active: '1', size: '1GB', reclaimable: '200MB' }],
        });
      }
      if (url.includes('/api/v1/docker/')) {
        return json({
          ok: true,
          items: [],
          daemon: {
            path: '/etc/docker/daemon.json',
            exists: true,
            logMaxSize: '10m',
            liveRestore: false,
            registryMirrors: [],
            insecureRegistries: [],
          },
        });
      }
      return json({ ok: true, items: [], missing: [], ready: true });
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DockerPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /containers/i })).toBeInTheDocument();
    });
    expect(screen.getByText('27.0.3')).toBeInTheDocument();
    expect(screen.queryByText(/type prune/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^images$/i }));
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'alpine:3.20' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: /^prune$/i }));
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /stopped containers/i })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /i understand unused data/i })).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/type prune/i)).not.toBeInTheDocument();
  });
});
