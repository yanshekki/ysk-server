import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { authStore } from '../../shared/stores/auth-store';
import { officialLatestDockerTag, ValidatorsPage, versionOptionLabel } from './ValidatorsPage';

describe('ValidatorsPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    authStore.setSession('tok', { username: 'admin', roles: ['admin'] });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/clients/') && url.includes('/versions')) {
        const clientId = url.match(/clients\/([^/?]+)/)?.[1] ?? 'client';
        return new Response(
          JSON.stringify({
            ok: true,
            clientId,
            image: 'ghcr.io/example/node',
            pin: 'v1.0.0',
            latest: 'v1.0.0',
            github: 'example/node',
            changelogUrl: null,
            registryHost: 'ghcr.io',
            at: null,
            error: null,
            versions: [
              { gitTag: 'v1.0.0', dockerTag: 'v1.0.0', prerelease: false, htmlUrl: '' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
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

  it('labels official latest without saying the pin was tested', () => {
    const t = (k: string) =>
      ({
        'validators.software.official': 'Official latest',
        'validators.clients.pin': 'Panel pin',
        'validators.clients.current': 'Running now',
        'validators.clients.prerelease': 'Prerelease',
      })[k] ?? k;
    const latest = {
      gitTag: '11.1.0',
      dockerTag: '11.1.0',
      prerelease: false,
      htmlUrl: '',
    };
    const pin = {
      gitTag: '11.0.1',
      dockerTag: '11.0.1',
      prerelease: false,
      htmlUrl: '',
    };
    expect(versionOptionLabel(latest, '11.0.1', undefined, '11.1.0', t)).toBe(
      '11.1.0 · Official latest',
    );
    expect(versionOptionLabel(pin, '11.0.1', undefined, '11.1.0', t)).toBe('11.0.1 · Panel pin');
    expect(versionOptionLabel(pin, '11.0.1', undefined, '11.0.1', t)).toBe(
      '11.0.1 · Official latest',
    );
    expect(
      officialLatestDockerTag({
        clientId: 'cardano-node',
        image: 'ghcr.io/intersectmbo/cardano-node',
        pin: '11.0.1',
        latest: '11.1.0',
        github: 'IntersectMBO/cardano-node',
        changelogUrl: null,
        registryHost: 'ghcr.io',
        at: null,
        error: null,
        versions: [latest, pin],
      }),
    ).toBe('11.1.0');
  });

  it('lets the wizard pick the official latest Cardano tag', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/clients/cardano-node/versions')) {
        return new Response(
          JSON.stringify({
            ok: true,
            clientId: 'cardano-node',
            image: 'ghcr.io/intersectmbo/cardano-node',
            pin: '11.0.1',
            latest: '11.1.0',
            github: 'IntersectMBO/cardano-node',
            changelogUrl: 'https://github.com/IntersectMBO/cardano-node/releases',
            registryHost: 'ghcr.io',
            at: new Date().toISOString(),
            error: null,
            versions: [
              { gitTag: '11.1.0', dockerTag: '11.1.0', prerelease: false, htmlUrl: '' },
              { gitTag: '11.0.1', dockerTag: '11.0.1', prerelease: false, htmlUrl: '' },
              { gitTag: '10.7.1', dockerTag: '10.7.1', prerelease: false, htmlUrl: '' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/clients/') && url.includes('/versions')) {
        return new Response(
          JSON.stringify({
            ok: true,
            clientId: 'reth',
            pin: 'v1.4.8',
            latest: 'v1.4.8',
            versions: [{ gitTag: 'v1.4.8', dockerTag: 'v1.4.8', prerelease: false, htmlUrl: '' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
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
              {
                id: 'ada',
                networks: [{ id: 'preview', kind: 'testnet', recommended: true }],
                clients: [{ id: 'cardano-node', role: 'node' }],
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
            disk: { instances: [], availBytes: 1e12, memAvailableBytes: 32e9 },
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
    render(
      <MemoryRouter>
        <ValidatorsPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create node/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /create node/i }));
    await user.click(screen.getByRole('radio', { name: /cardano/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    const select = await screen.findByLabelText(/^version$/i);
    await waitFor(() => {
      expect(select).toHaveValue('11.1.0');
    });
    expect(screen.getByRole('option', { name: '11.1.0 · Official latest' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '11.0.1 · Panel pin' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '10.7.1' })).toBeInTheDocument();
    expect(screen.queryByText(/tested/i)).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('refresh=1'))).toBe(true);
  });

  it('opens Cardano details with KES / VRF / opcert file inputs and type-to-confirm, never a cold key field', async () => {
    const user = userEvent.setup();
    const ada = {
      id: 'ada-preview-1',
      chain: 'ada',
      network: 'preview',
      profile: 'minimal',
      desiredState: 'stopped',
      ports: { p2p: 3001, metrics: 12798 },
      cardanoProducer: {
        attached: false,
        kesPresent: false,
        vrfPresent: false,
        opcertPresent: false,
        kesFp: null,
        vrfFp: null,
        opcertFp: null,
        attachedAt: null,
      },
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/validators/chains')) {
        return new Response(
          JSON.stringify({
            ok: true,
            chains: [
              {
                id: 'ada',
                networks: [
                  { id: 'preview', kind: 'testnet', recommended: true },
                  { id: 'mainnet', kind: 'mainnet' },
                ],
                clients: [{ id: 'cardano-node', role: 'node' }],
              },
            ],
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
      if (url.includes('/status')) {
        return new Response(
          JSON.stringify({ ok: true, status: 'stopped', running: false, lastError: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/logs')) {
        return new Response(JSON.stringify({ ok: true, lines: [], notes: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/compose')) {
        return new Response(
          JSON.stringify({ ok: true, path: '/tmp/compose.yml', content: 'services: {}\n', notes: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/stats')) {
        return new Response(JSON.stringify({ ok: true, items: [], notes: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/checklist')) {
        return new Response(
          JSON.stringify({ ok: true, items: [], links: [], cardanoProducer: ada.cardanoProducer }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/v1/validators')) {
        return new Response(JSON.stringify({ ok: true, instances: [ada] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
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
      expect(screen.getByText('ada-preview-1')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /^details$/i }));
    expect(await screen.findByTestId('cardano-producer')).toBeInTheDocument();
    expect(document.getElementById('ada-kes')).toHaveAttribute('type', 'file');
    expect(document.getElementById('ada-vrf')).toHaveAttribute('type', 'file');
    expect(document.getElementById('ada-opcert')).toHaveAttribute('type', 'file');
    expect(document.getElementById('ada-cold')).toBeNull();
    expect(screen.queryByLabelText(/cold\.skey/i)).toBeNull();
    const apply = screen.getByRole('button', { name: /apply and restart as block producer/i });
    expect(apply).toBeDisabled();
    const kes = new File(
      ['{"type":"KesSigningKey_ed25519_kes_2^6","cborHex":"aa"}'],
      'kes.skey',
      { type: 'application/json' },
    );
    await user.upload(document.getElementById('ada-kes') as HTMLInputElement, kes);
    await waitFor(() => {
      expect(apply).not.toBeDisabled();
    });
    await user.click(apply);
    expect(await screen.findByRole('heading', { name: /attach hot keys to ada-preview-1/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('ada-preview-1')).toBeInTheDocument();
    expect(document.querySelector('[data-confirm="ada-preview-1"]')).toBeTruthy();
  });

  it('shows a RAM short warning on NEAR without freezing Next, and clears the 12g cap when switching chain', async () => {
    const user = userEvent.setup();
    const GiB = 1024 ** 3;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
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
                minFreeBytes: { hoodi: { minimal: 40 * GiB } },
              },
              {
                id: 'near',
                networks: [
                  { id: 'testnet', kind: 'testnet', recommended: true },
                  { id: 'mainnet', kind: 'mainnet' },
                ],
                clients: [{ id: 'neard', role: 'node' }],
                minFreeBytes: { testnet: { minimal: 50 * GiB } },
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
              instances: [],
              availBytes: 58.6 * GiB,
              memAvailableBytes: 4 * GiB,
            },
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
    render(
      <MemoryRouter>
        <ValidatorsPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create node/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /create node/i }));
    await user.click(screen.getByRole('radio', { name: /near/i }));
    expect(await screen.findByText(/not enough free ram/i)).toBeInTheDocument();
    const next = screen.getByRole('button', { name: /^next$/i });
    expect(next).not.toBeDisabled();
    await user.click(next);
    expect(await screen.findByText(/50\.0 GiB · free 58\.6 GiB/i)).toBeInTheDocument();
    expect(screen.getByText(/not enough free ram/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next$/i })).not.toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    const install = screen.getByRole('button', { name: /^install$/i });
    expect(install).not.toBeDisabled();
    expect(install).toHaveAttribute('data-confirm', 'dialog');
    await user.click(install);
    expect(await screen.findByRole('heading', { name: /install this node/i })).toBeInTheDocument();
    const confirmDlg = screen.getByRole('heading', { name: /install this node/i }).closest(
      '[role="dialog"]',
    ) as HTMLElement;
    expect(within(confirmDlg).getByText(/memory cap plus 1 gib headroom/i)).toBeInTheDocument();
    expect(within(confirmDlg).getByLabelText(/near-testnet-1/i)).toBeInTheDocument();
    await user.click(within(confirmDlg).getByRole('button', { name: /^cancel$/i }));
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    await user.click(screen.getByRole('radio', { name: /ethereum/i }));
    await waitFor(() => {
      expect(screen.queryByText(/not enough free ram/i)).toBeNull();
    });
    expect(screen.getByRole('button', { name: /^next$/i })).not.toBeDisabled();
  });
});
