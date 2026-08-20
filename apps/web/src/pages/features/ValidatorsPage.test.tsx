import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { authStore } from '../../shared/stores/auth-store';
import { ValidatorsPage } from './ValidatorsPage';

describe('ValidatorsPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    authStore.setSession('tok', { username: 'admin', roles: ['admin'] });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/validators/netio')) {
        return new Response(JSON.stringify({ ok: true, items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/validators/chains')) {
        return new Response(
          JSON.stringify({
            ok: true,
            chains: [
              {
                id: 'eth',
                networks: [{ id: 'hoodi', kind: 'testnet', recommended: true }],
                clients: [
                  { id: 'reth', role: 'el' },
                  { id: 'lighthouse', role: 'cl' },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/v1/validators/disk')) {
        return new Response(
          JSON.stringify({
            ok: true,
            disk: {
              rootPath: '/tmp/ysk/validators',
              totalBytes: 1000,
              usedBytes: 200,
              availBytes: 800,
              usePct: 20,
              tone: 'ok',
              instances: [],
              notes: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/v1/validators/software')) {
        return new Response(
          JSON.stringify({
            ok: true,
            dockerInstalled: true,
            dockerRunning: true,
            composeAvailable: true,
            dockerVersion: '29.1.3',
            composeVersion: '2.40.3',
            images: [
              {
                chain: 'eth',
                clientId: 'reth',
                role: 'el',
                image: 'ghcr.io/paradigmxyz/reth',
                tag: 'v1.4.8',
                ref: 'ghcr.io/paradigmxyz/reth:v1.4.8',
                present: false,
                size: null,
                usedBy: [],
              },
            ],
            executeEnabled: true,
            isRoot: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/v1/validators')) {
        return new Response(JSON.stringify({ ok: true, instances: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('renders empty nodes tab and can open disk / about', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ValidatorsPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create node/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/no validator nodes yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /disk/i }));
    await waitFor(() => {
      expect(screen.getByText('/tmp/ysk/validators')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: /software/i }));
    await waitFor(() => {
      expect(screen.getByText(/ghcr.io\/paradigmxyz\/reth:v1.4.8/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: /about/i }));
  });

  it('wizard summary reviews chain, network, and profile as facts', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ValidatorsPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create node/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /create node/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    expect(await screen.findByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText('Hoodi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^install$/i })).toBeInTheDocument();
  });

  it('lists a delete action that asks for the instance id', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/validators/chains')) {
        return new Response(
          JSON.stringify({
            ok: true,
            chains: [{ id: 'eth', networks: [{ id: 'hoodi', kind: 'testnet' }] }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/v1/validators/disk')) {
        return new Response(JSON.stringify({ ok: true, disk: { instances: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/validators')) {
        return new Response(
          JSON.stringify({
            ok: true,
            instances: [
              {
                id: 'eth-hoodi-1',
                chain: 'eth',
                network: 'hoodi',
                profile: 'minimal',
                desiredState: 'stopped',
                ports: { rpc: 8545, p2p: 30303 },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    render(
      <MemoryRouter>
        <ValidatorsPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(await screen.findByRole('heading', { name: /delete eth-hoodi-1/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('eth-hoodi-1')).toBeInTheDocument();
  });

  it('does not repeat testnet in the network column and localizes status', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/validators/chains')) {
        return new Response(JSON.stringify({ ok: true, chains: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/validators/disk')) {
        return new Response(JSON.stringify({ ok: true, disk: { instances: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/validators')) {
        return new Response(
          JSON.stringify({
            ok: true,
            instances: [
              {
                id: 'near-testnet-1',
                chain: 'near',
                network: 'testnet',
                profile: 'minimal',
                desiredState: 'stopped',
                lastStatus: { status: 'stopped', running: false, lastError: null },
                ports: {},
              },
              {
                id: 'eth-hoodi-1',
                chain: 'eth',
                network: 'hoodi',
                profile: 'minimal',
                desiredState: 'stopped',
                lastStatus: { status: 'stopped', running: false, lastError: null },
                ports: {},
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    render(
      <MemoryRouter>
        <ValidatorsPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText('near-testnet-1')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Testnet')).toHaveLength(2);
    expect(screen.getByText('Hoodi')).toBeInTheDocument();
    expect(screen.getAllByText('Stopped').length).toBeGreaterThan(0);
    expect(screen.queryByText('stopped')).toBeNull();
  });

  it('shows live ↓ / ↑ traffic like the BT library', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/validators/netio')) {
        return new Response(
          JSON.stringify({
            ok: true,
            items: [
              {
                id: 'avax-fuji-1',
                rxBytes: 5000,
                txBytes: 1000,
                rxRateBps: 1024,
                txRateBps: 512,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/v1/validators/chains')) {
        return new Response(JSON.stringify({ ok: true, chains: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/validators/disk')) {
        return new Response(JSON.stringify({ ok: true, disk: { instances: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/validators')) {
        return new Response(
          JSON.stringify({
            ok: true,
            instances: [
              {
                id: 'avax-fuji-1',
                chain: 'avax',
                network: 'fuji',
                profile: 'minimal',
                desiredState: 'running',
                lastStatus: { status: 'rpc_wait', running: true, lastError: null },
                ports: {},
              },
            ],
            summaries: [
              {
                id: 'avax-fuji-1',
                status: 'rpc_wait',
                running: true,
                syncProgress: null,
                peers: 0,
                diskUsedBytes: 18432,
                lastError: null,
                upgrade: null,
                rxBytes: 5000,
                txBytes: 1000,
                rxRateBps: 1024,
                txRateBps: 512,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    render(
      <MemoryRouter>
        <ValidatorsPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText('avax-fuji-1')).toBeInTheDocument();
    });
    expect(screen.getByText('Traffic')).toBeInTheDocument();
    expect(screen.getByText('↓ 1.0 KB/s · ↑ 512 B/s')).toBeInTheDocument();
  });
});
