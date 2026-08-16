import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { authStore } from '../../shared/stores/auth-store';
import { DockerPage } from './DockerPage';

describe('DockerPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    authStore.setSession('tok', { username: 'admin', roles: ['admin'] });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      if (url.endsWith('/api/v1/docker') || url.includes('/api/v1/docker?')) {
        return json({
          ok: true,
          status: {
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
          },
        });
      }
      if (url.includes('/api/v1/docker/')) {
        return json({ ok: true, items: [], daemon: { path: '/etc/docker/daemon.json', exists: false } });
      }
      return json({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('renders overview and can open containers tab', async () => {
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
    await user.click(screen.getByRole('tab', { name: /about/i }));
    await waitFor(() => {
      expect(screen.getByText(/first-class host service/i)).toBeInTheDocument();
    });
  });
});
