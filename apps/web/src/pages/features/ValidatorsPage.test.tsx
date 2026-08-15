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
      if (url.includes('/api/v1/validators/chains')) {
        return new Response(
          JSON.stringify({
            ok: true,
            chains: [
              {
                id: 'eth',
                networks: [{ id: 'hoodi', kind: 'testnet', recommended: true }],
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
    await user.click(screen.getByRole('tab', { name: /about/i }));
  });
});
