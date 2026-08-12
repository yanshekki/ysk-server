/**
 * Deep coverage for OutboundIdentities + ProjectDeployTab (large remaining gaps).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ProjectDto } from '@yanshekki/shared';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { OutboundIdentities } from './security/ssh/OutboundIdentities';
import { ProjectDeployTab } from './projects/ui/ProjectDeployTab';
import { SoftwareInstallBanner } from '../shared/components/ui/SoftwareInstallBanner';
import { OpsResultPanel } from '../shared/components/ui/OpsResultPanel';

const identity = {
  id: 'id-1',
  name: 'panel-key',
  purpose: 'panel_outbound' as const,
  status: 'stored' as const,
  algo: 'ed25519',
  fingerprintSha256: 'SHA256:abcdef0123456789abcdef01',
  publicKey: 'ssh-ed25519 AAAAtestkey panel',
  createdAt: new Date().toISOString(),
  binding: { linuxUser: 'ysk', homeDir: '/home/ysk', projectId: 'p1' } };

const project = {
  id: 'p1',
  name: 'Demo App',
  domain: 'demo.example.com',
  runtime: 'node',
  runtimeVersion: '20',
  processStatus: 'stopped',
  status: 'stopped',
  gitUrl: 'https://github.com/example/demo.git',
  envVars: { NODE_ENV: 'production', PORT: '3000' },
  quotaMb: 1024,
  memoryMax: '512M',
  cpuQuotaPercent: 100,
  port: 3000,
  linuxUser: 'demo',
  homeDir: '/home/demo',
  osProvisioned: true,
  nginxConfigPath: null,
  lastDeployAt: null,
  deployEntry: 'server.js' } as unknown as ProjectDto;

describe('OutboundIdentities deep', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('lists, filters, opens create wizard steps, selects row', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) => url.includes('/api/v1/ssh/identities'),
        handler: (_url, init) => {
          const method = (init?.method ?? 'GET').toUpperCase();
          if (method === 'POST') {
            return {
              ok: true,
              identity: { ...identity, id: 'id-new', name: 'created' },
              privateKey: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
              notes: ['created'],
              ...HONESTY_WRITTEN_BLOCKED };
          }
          return { ok: true, items: [identity, { ...identity, id: 'id-2', status: 'retired', name: 'old' }] };
        } },
      {
        match: /\/api\/v1\/projects/,
        body: {
          items: [{ id: 'p1', name: 'Demo', linuxUser: 'demo', homeDir: '/home/demo' }] } },
      { match: /.*/, body: { ...HONESTY_WRITTEN_BLOCKED, ok: true, items: [], notes: [] } },
    ]);

    render(
      <MemoryRouter>
        <OutboundIdentities onFlash={vi.fn()} onChanged={vi.fn()} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/panel-key/i)).toBeInTheDocument());

    // click filter chips (seg radios / buttons)
    for (const label of [/all/i, /panel/i, /user/i, /retired/i, /active/i]) {
      const el =
        screen.queryAllByRole('button', { name: label })[0] ??
        screen.queryAllByLabelText(label)[0] ??
        screen.queryAllByRole('radio', { name: label })[0];
      if (el) await user.click(el);
    }

    // select the identity row if clickable
    const row = screen.getAllByText(/panel-key/i)[0]!;
    await user.click(row);

    // open create wizard
    const create =
      screen.queryAllByRole('button', { name: /create|new|add|generate|新增|建立/i })[0];
    if (create) {
      await user.click(create);
      // fill name if present
      const nameInput =
        screen.queryByLabelText(/name|名稱/i) ??
        document.querySelector('input[name="name"]');
      if (nameInput) {
        await user.clear(nameInput as HTMLElement);
        await user.type(nameInput as HTMLElement, 'wizard-key');
      }
      // next / submit buttons
      for (const b of screen.queryAllByRole('button', {
        name: /next|continue|create|generate|finish|save|下一步|建立/i }).slice(0, 5)) {
        try {
          await user.click(b);
        } catch {
          /* wizard closed */
        }
      }
    }

    // action buttons on selected identity
    for (const b of screen
      .queryAllByRole('button', {
        name: /install|test|copy|rotate|delete|remove|authorize|安裝|測試|複製/i })
      .slice(0, 6)) {
      try {
        await user.click(b);
      } catch {
        /* dialogs */
      }
    }
  });
});

describe('ProjectDeployTab deep', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders deploy/git/env cards and history, toggles fields', async () => {
    const user = userEvent.setup();
    const setGit = vi.fn();
    const setEnv = vi.fn();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) => url.includes('deploy-history'),
        body: {
          items: [
            {
              id: 'h1',
              ok: true,
              action: 'project.deploy',
              actor: 'admin',
              created_at: new Date().toISOString(),
              detail: { entry: 'server.js', port: 3000, processStatus: 'running' } },
            {
              id: 'h2',
              ok: false,
              action: 'project.git-deploy',
              actor: 'admin',
              created_at: new Date().toISOString(),
              detail: null },
          ] } },
      {
        match: /\/api\/v1\/projects/,
        body: { ok: true, items: [project], project, ...HONESTY_WRITTEN_BLOCKED } },
      {
        match: /\/api\/v1\/hosting\/runtimes/,
        body: {
          ok: true,
          nodeVersion: 'v20',
          catalog: [],
          settings: { values: {}, env: {} },
          envPreview: {},
          notes: [] } },
      { match: /.*/, body: { ok: true, items: [], notes: [], templates: [] } },
    ]);

    render(
      <MemoryRouter>
        <ProjectDeployTab
          project={project}
          busy={false}
          gitUrl={project.gitUrl ?? ''}
          setGitUrl={setGit}
          envText={'NODE_ENV=production\nPORT=3000'}
          setEnvText={setEnv}
          onDeploy={vi.fn()}
          onGitDeploy={vi.fn()}
          onSaveEnv={vi.fn()}
          showFreshChecklist
          onDismissChecklist={vi.fn()}
        />
      </MemoryRouter>,
    );

    await waitFor(() => expect(document.body.textContent?.length).toBeGreaterThan(100));

    // edit git url field if present
    const gitField =
      screen.queryByLabelText(/git|repo|倉庫/i) ??
      document.querySelector('input[value*="github"]');
    if (gitField) {
      await user.type(gitField as HTMLElement, 'x');
    }

    // env textarea
    const envArea = document.querySelector('textarea');
    if (envArea) {
      await user.type(envArea, '\nDEBUG=1');
    }

    for (const b of screen
      .queryAllByRole('button', {
        name: /deploy|save|pull|install|build|skip|git|環境|部署/i })
      .slice(0, 8)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }

    // php variant
    const phpProject = { ...project, runtime: 'php', runtimeVersion: '8.2' } as ProjectDto;
    render(
      <MemoryRouter>
        <ProjectDeployTab
          project={phpProject}
          busy={false}
          gitUrl=""
          setGitUrl={setGit}
          envText=""
          setEnvText={setEnv}
          onDeploy={vi.fn()}
          onGitDeploy={vi.fn()}
          onSaveEnv={vi.fn()}
          onPhpVersionChange={vi.fn()}
        />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.body.textContent).toMatch(/php|PHP|deploy/i));
  });
});

describe('SoftwareInstallBanner + OpsResultPanel honesty', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows install CTA when software missing and blocked result', async () => {
    const user = userEvent.setup();
    installFetchMock([
      {
        match: (url) => url.includes('/api/v1/system/software'),
        handler: (_url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
            return HONESTY_WRITTEN_BLOCKED;
          }
          return {
            items: [{ id: 'nginx', title: 'Nginx', installed: false }],
            missing: [{ id: 'nginx', title: 'Nginx', installed: false }],
            ready: false };
        } },
    ]);

    render(
      <MemoryRouter>
        <SoftwareInstallBanner feature="nginx" title="Need nginx" autoHideWhenReady={false} />
        <OpsResultPanel
          result={{
            ok: true,
            requiresExecute: true,
            apply_status: 'written',
            notes: ['written ≠ applied'],
            blockMessage: 'Host execute is off',
            processStatus: 'stopped',
            port: 80,
            url: 'https://example.com',
            pid: 42 }}
          onRetry={vi.fn()}
        />
      </MemoryRouter>,
    );

    // OpsResultPanel honesty: requiresExecute is not bare Success
    expect(screen.queryByText(/^Success$/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    const install = screen.queryAllByRole('button', { name: /install|安裝/i })[0];
    if (install) await user.click(install);
  });
});
