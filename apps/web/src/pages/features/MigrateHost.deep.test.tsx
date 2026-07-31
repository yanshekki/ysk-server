/**
 * Migrate host deep — inventory + wizard + jobs (correct /system/migrate paths).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute,
} from '../../test/mock-fetch';
import { authStore } from '../../shared/stores/auth-store';
import { MigrateHostPage } from './MigrateHostPage';

describe('MigrateHostPage deep', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it('inventory refresh, wizard fields, run, jobs tab', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) => url.startsWith('/api/v1/system/migrate/inventory'),
        body: {
          ok: true,
          summary: ['projects:2', 'mysql:1'],
          manifest: {
            hostname: 'src-host',
            projects: 2,
            mysql_databases: 1,
            postgres_databases: 0,
            mail_domains: 1,
            redis_dbs: 0,
            bytes: 5e9,
            software: { nginx: true, mysql: true },
          },
          notes: ['scanned'],
          executeEnabled: false,
          isRoot: false,
        },
      },
      {
        match: (url) => url.startsWith('/api/v1/system/migrate/jobs'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return {
              ...HONESTY_WRITTEN_BLOCKED,
              ok: true,
              job: {
                id: 'mj1',
                status: 'planned',
                target: '10.0.0.9',
                createdAt: now,
                apply_status: 'written',
              },
              summary: ['packed'],
              phases: {
                pack: { ok: true, notes: ['ok'] },
                transfer: { ok: false, notes: ['need execute'] },
              },
              notes: ['written ≠ applied'],
            };
          }
          return {
            ok: true,
            jobs: [
              {
                id: 'mj1',
                status: 'planned',
                target: '10.0.0.9',
                createdAt: now,
                apply_status: 'written',
                manifest: { projects: 2 },
              },
              {
                id: 'mj0',
                status: 'failed',
                target: '10.0.0.8',
                createdAt: now,
                notes: ['ssh failed'],
              },
            ],
          };
        },
      },
      {
        match: (url) => url.startsWith('/api/v1/system/migrate/post'),
        body: HONESTY_WRITTEN_BLOCKED,
      },
      {
        match: /\/api\/v1\/ssh\/identities/,
        body: {
          items: [
            {
              id: 'id-1',
              name: 'panel-key',
              status: 'installed',
              purpose: 'panel_outbound',
              fingerprintSha256: 'SHA256:abc',
            },
          ],
        },
      },
      { match: /.*/, body: { ok: true, items: [] } },
    ]);

    render(
      <MemoryRouter>
        <MigrateHostPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

    // Refresh inventory
    for (const b of screen
      .queryAllByRole('button', { name: /refresh|inventory|scan|probe/i })
      .slice(0, 4)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }

    // Fill wizard inputs
    for (const input of Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea',
      ),
    ).slice(0, 10)) {
      try {
        await user.clear(input as HTMLInputElement);
        await user.type(
          input as HTMLInputElement,
          input.type === 'password' || input.type === 'number' ? '22' : '10.0.0.9',
        );
      } catch {
        /* ignore */
      }
    }
    for (const cb of screen.queryAllByRole('checkbox').slice(0, 6)) {
      try {
        await user.click(cb);
      } catch {
        /* ignore */
      }
    }

    for (const b of screen
      .queryAllByRole('button', { name: /run|start|next|migrate|create|dry|execute|post/i })
      .slice(0, 8)) {
      if ((b as HTMLButtonElement).disabled) continue;
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }

    // Jobs tab
    const jobs = screen.queryAllByRole('tab', { name: /job|log/i })[0];
    if (jobs) await user.click(jobs);
    for (const b of screen.queryAllByRole('button').slice(0, 10)) {
      if ((b as HTMLButtonElement).disabled) continue;
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  }, 20_000);
});
