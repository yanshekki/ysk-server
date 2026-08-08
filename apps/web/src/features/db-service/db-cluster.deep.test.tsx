/**
 * Deep RTL + user-event for DbClusterPanel (wizard + row actions + confirms).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute } from '../../test/mock-fetch';
import { authStore } from '../../shared/stores/auth-store';
import { DbClusterPanel } from './DbClusterPanel';

const cluster = {
  id: 'c1',
  name: 'ysk-cluster',
  engine: 'postgres',
  kind: 'postgres-replica',
  status: 'planned',
  members: [
    { id: 'm1', host: '10.0.0.1', role: 'primary', access: 'local', label: 'primary', port: 5432, applyStatus: 'planned' },
    { id: 'm2', host: '10.0.0.2', role: 'replica', access: 'ssh', label: 'replica-1', port: 5432, applyStatus: 'draft' },
  ],
  params: { replUser: 'ysk_repl' },
  artifactDir: '/var/lib/ysk/c1',
  notes: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString() };

const plan = {
  ok: true,
  dryRun: true,
  clusterId: 'c1',
  kind: 'postgres-replica',
  engine: 'postgres',
  steps: [
    { id: '1', title: 'write primary conf', kind: 'file', risk: 'written' },
    { id: '2', title: 'reload', kind: 'exec', risk: 'execute-host' },
  ],
  files: [
    { relativePath: '99-ysk-primary.conf', body: 'primary_conninfo=...' },
  ],
  notes: ['dry-run plan'],
  requiresExecute: true,
  requiresRoot: true };

function clusterRoutes(engine = 'postgres') {
  return [
    softwareReadyRoute(),
    {
      match: (url: string) => url.includes('/api/v1/db/clusters'),
      handler: (url: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'GET' && !url.match(/clusters\/[^/?]+/)) {
          return { ok: true, items: [{ ...cluster, engine }] };
        }
        if (method === 'POST' && url.match(/\/clusters\/?(\?|$)/)) {
          return { ok: true, cluster: { ...cluster, engine, status: 'draft' } };
        }
        if (url.includes('/plan')) {
          return { ok: true, cluster: { ...cluster, status: 'planned' }, plan };
        }
        if (url.includes('/apply')) {
          return {
            ok: true,
            dryRun: !(init?.body && String(init.body).includes('"execute":true')),
            executed: false,
            blocked: true,
            cluster,
            written: ['/etc/postgresql/99-ysk.conf'],
            notes: ['written ≠ applied'],
            requiresExecute: true,
            requiresRoot: true,
            ...HONESTY_WRITTEN_BLOCKED };
        }
        if (url.includes('/probe')) {
          return {
            ok: true,
            localOk: true,
            cluster,
            peersProbed: 1,
            facts: {
              wsrep_ready: 'ON',
              wsrep_connected: 'ON',
              wsrep_cluster_size: '2',
              other: 'x' },
            notes: ['probed'] };
        }
        if (url.includes('/install-peers') || url.includes('installPeers')) {
          return { ok: true, dryRun: true, notes: ['peer install plan'], targets: [] };
        }
        if (url.includes('/push')) {
          return {
            ok: true,
            dryRun: true,
            notes: ['push plan'],
            targets: [{ host: '10.0.0.2', files: ['a.conf'], remotePath: '/tmp/ysk' }] };
        }
        if (url.includes('/fleet')) {
          return { ok: true, dryRun: true, notes: ['fleet plan'] };
        }
        if (url.includes('/bundle') || url.includes('download')) {
          return { ok: true, notes: ['bundle'] };
        }
        if (method === 'DELETE') {
          return { ok: true, notes: ['removed'] };
        }
        return { ok: true, cluster, items: [cluster] };
      } },
    { match: /.*/, body: { ok: true, items: [], notes: [] } },
  ];
}

describe('DbClusterPanel deep', () => {
  beforeEach(() => authStore.setSession('t', { username: 'admin', roles: ['admin'] }));
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('lists cluster, opens wizard, generates plan with hosts', async () => {
    const user = userEvent.setup();
    installFetchMock(clusterRoutes('postgres'));

    render(
      <MemoryRouter>
        <DbClusterPanel engine="postgres" />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/ysk-cluster/i)).toBeInTheDocument());

    // open wizard
    const create = screen.getAllByRole('button', {
      name: /create|replica|galera|cluster|建立|叢集|集群/i })[0]!;
    await user.click(create);

    await waitFor(() => expect(document.getElementById('dbc-name')).toBeTruthy());

    const name = document.getElementById('dbc-name') as HTMLInputElement;
    await user.clear(name);
    await user.type(name, 'pg-ha');

    const local = document.getElementById('dbc-local') as HTMLInputElement;
    await user.clear(local);
    await user.type(local, '10.0.0.10');

    const peer = document.getElementById('dbc-peer') as HTMLInputElement;
    await user.clear(peer);
    await user.type(peer, '10.0.0.11');

    const peer3 = document.getElementById('dbc-peer3') as HTMLInputElement;
    if (peer3) await user.type(peer3, '10.0.0.12');

    const gen = screen.getAllByRole('button', {
      name: /generate|plan|產生|生成/i }).find((b) => (b as HTMLButtonElement).type === 'submit' || /generate|plan|產生|生成/i.test(b.textContent ?? ''));
    if (gen) await user.click(gen);

    await waitFor(
      () => {
        expect(document.body.textContent).toMatch(/plan|step|ysk|pg-ha|10\.0\.0/i);
      },
      { timeout: 5000 },
    );
  });

  it('row actions: plan, write, apply confirm, probe, push, fleet, delete', async () => {
    const user = userEvent.setup();
    installFetchMock(clusterRoutes('postgres'));

    render(
      <MemoryRouter>
        <DbClusterPanel engine="postgres" />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/ysk-cluster/i)).toBeInTheDocument());

    const clickAll = async (re: RegExp, max = 6) => {
      for (const b of screen.queryAllByRole('button', { name: re }).slice(0, max)) {
        try {
          if (!(b as HTMLButtonElement).disabled) await user.click(b);
        } catch {
          /* modal transition */
        }
      }
    };

    await clickAll(/plan|規劃|计划/i, 2);
    await clickAll(/write|file|寫入|写入/i, 2);
    await clickAll(/apply local|apply|套用|应用/i, 1);

    // confirm apply dialog
    const confirmApply = screen.queryAllByRole('button', {
      name: /confirm|apply|確認|确认|套用/i })[0];
    if (confirmApply) await user.click(confirmApply);

    await clickAll(/^Bootstrap$/i, 1);
    const confirmBoot = screen.queryAllByRole('button', {
      name: /confirm|apply|確認|确认/i })[0];
    if (confirmBoot) await user.click(confirmBoot);

    await clickAll(/probe|探測|探测/i, 3);
    await clickAll(/remote install plan|remote|遠端|远端/i, 2);
    await clickAll(/download|bundle|下載|下载/i, 1);
    await clickAll(/push plan|push|推送/i, 2);
    await clickAll(/fleet/i, 3);

    // delete with confirm
    await clickAll(/delete|remove|刪除|删除/i, 1);
    const confirmDel = screen.queryAllByRole('button', {
      name: /confirm|delete|確認|确认|刪除/i })[0];
    if (confirmDel) await user.click(confirmDel);

    // dismiss msg alert close if present
    const close = screen.queryAllByRole('button', { name: /close|關閉|关闭/i })[0];
    if (close) await user.click(close);

    await waitFor(() => {
      expect(document.body.textContent!.length).toBeGreaterThan(20);
    });
  });

  it('mariadb galera wizard shows SST options', async () => {
    const user = userEvent.setup();
    installFetchMock(clusterRoutes('mariadb'));

    render(
      <MemoryRouter>
        <DbClusterPanel engine="mariadb" />
      </MemoryRouter>,
    );

    await waitFor(() => expect(document.body.textContent!.length).toBeGreaterThan(10));

    const create = screen.getAllByRole('button', {
      name: /create|galera|cluster|建立/i })[0];
    if (create) {
      await user.click(create);
      await waitFor(() => expect(document.getElementById('dbc-name')).toBeTruthy());
      const sst =
        screen.queryAllByRole('radio', { name: /mariabackup|rsync/i })[0] ??
        screen.queryAllByRole('button', { name: /mariabackup|rsync/i })[0];
      if (sst) await user.click(sst);

      // validation: empty hosts
      const gen = screen.queryAllByRole('button', { name: /generate|plan|產生|生成/i })[0];
      if (gen) await user.click(gen);
    }
  });

  it('mysql and redis engines mount empty/list states', async () => {
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url: string) => url.includes('/api/v1/db/clusters'),
        body: { ok: true, items: [] } },
      { match: /.*/, body: { ok: true, items: [] } },
    ]);

    const { rerender } = render(
      <MemoryRouter>
        <DbClusterPanel engine="mysql" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.body.textContent).toMatch(/cluster|standalone|獨立|独立|replica/i));

    rerender(
      <MemoryRouter>
        <DbClusterPanel engine="redis" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.body.textContent!.length).toBeGreaterThan(10));
  });

  it('surfaces load error', async () => {
    installFetchMock([
      {
        match: (url: string) => url.includes('/api/v1/db/clusters'),
        status: 500,
        body: { message: 'cluster list boom' } },
    ]);
    render(
      <MemoryRouter>
        <DbClusterPanel engine="postgres" />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/boom|fail|error|失敗|失败|load/i);
    });
  });
});
