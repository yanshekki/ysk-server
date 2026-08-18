/**
 * Inventory panel: leftover homes appear once (table), not again as warnings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { installFetchMock, softwareReadyRoute } from '../../test/mock-fetch';
import { authStore } from '../../shared/stores/auth-store';
import { MigrateHostPage } from './MigrateHostPage';

describe('MigrateHostPage inventory layout', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it('does not list leftover homes twice and formats mtime', async () => {
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) => url.includes('/api/v1/system/migrate/inventory'),
        body: {
          ok: true,
          manifest: {
            source: {
              hostname: 'hermes',
              os: 'linux 6.8',
              dataDir: '/var/lib/ysk-server',
            },
            counts: {
              projects: 1,
              mailboxes: 1,
              users: 2,
              mysql_databases: 0,
              postgres_databases: 0,
              redis_instances: 0,
            },
            softwareNeeded: ['nginx'],
            orphanHomes: ['/home/ysk-server-aaa', '/home/ysk-server-bbb'],
            orphanHomeStats: {
              '/home/ysk-server-aaa': { mtime: '2026-08-17T12:00:00.000Z' },
            },
            warnings: [
              '磁碟有孤立 主目錄（store 無對應）: /home/ysk-server-aaa',
              '磁碟有孤立 主目錄（store 無對應）: /home/ysk-server-bbb',
              'rsync missing from PATH',
            ],
          },
        },
      },
      {
        match: (url) => url.includes('/api/v1/system/migrate/jobs'),
        body: { ok: true, jobs: [] },
      },
    ]);

    render(
      <MemoryRouter>
        <MigrateHostPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('/home/ysk-server-aaa')).toBeInTheDocument();
    });

    expect(screen.getAllByText('/home/ysk-server-aaa')).toHaveLength(1);
    expect(screen.getAllByText('/home/ysk-server-bbb')).toHaveLength(1);
    expect(screen.queryByText(/磁碟有孤立/)).not.toBeInTheDocument();
    expect(screen.getByText('rsync missing from PATH')).toBeInTheDocument();
    expect(screen.getByText('hermes')).toBeInTheDocument();
    expect(screen.queryByText('2026-08-17T12:00:00.000Z')).not.toBeInTheDocument();
  });
});
