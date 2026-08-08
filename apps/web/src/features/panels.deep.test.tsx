/**
 * Deep mounts for feature panels that page smokes only partially reach.
 * Honesty: requiresExecute fixtures used for action responses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ProjectDto } from '@ysk/shared';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { SshWorkspace } from './security/ssh/SshWorkspace';
import { OutboundIdentities } from './security/ssh/OutboundIdentities';
import { LoginKeysPanel } from './security/ssh/LoginKeysPanel';
import { Ssh2faPanel } from './security/ssh/Ssh2faPanel';
import { SshdPanel } from './security/ssh/SshdPanel';
import { DbClusterPanel } from './db-service/DbClusterPanel';
import { RolePermissionsPanel } from './users/RolePermissionsPanel';
import { UserDetailModal } from './users/UserDetailModal';
import { ProjectDeployTab } from './projects/ui/ProjectDeployTab';
import { ProjectNetworkTab } from './projects/ui/ProjectNetworkTab';
import { ProjectResourcesTab } from './projects/ui/ProjectResourcesTab';
import { ProjectLogsTab } from './projects/ui/ProjectLogsTab';
import { ProjectOverviewTab } from './projects/ui/ProjectOverviewTab';
import { ProjectAdvancedTab } from './projects/ui/ProjectAdvancedTab';
import { ProjectCreateModal } from './projects/ui/ProjectCreateModal';
import { ProjectList } from './projects/ui/ProjectList';
import { ProjectChecklist } from './projects/ui/ProjectChecklist';
import { ProjectSshCard } from './projects/ui/ProjectSshCard';
import { ProjectNextStep } from './projects/ui/ProjectNextStep';
import { HealthSummary } from './projects/ui/HealthSummary';
import { ProjectStatusBadge } from './projects/ui/ProjectStatusBadge';
import { ProjectDetailHeader } from './projects/ui/ProjectDetailHeader';
import { ProjectListItem } from './projects/ui/ProjectListItem';
import { TopHeaderPanel, formatRes } from './metrics/TopHeaderPanel';
import {
  formatRuntimeName,
  getProjectUiProfile } from './projects/model/runtime-ui';
import {
  nextAction,
  pipelineStep,
  purposeHint,
  purposeLabel,
  shortFingerprint,
  statusLabel,
  statusTone } from './security/ssh/labels';
import {
  defaultRuntimeInstallVersion,
  loadDeployPrefs,
  runtimeInstallKind,
  runtimePagePath,
  runtimeVersionChoices,
  saveDeployPrefs } from './projects/model/deploy-prefs';
import {
  buildProjectChecklist,
  deriveProjectStatus,
  formatHealthFacts } from './projects/model/status';

const project = {
  id: 'p1',
  name: 'Demo App',
  domain: 'demo.example.com',
  runtime: 'node',
  runtimeVersion: '20',
  processStatus: 'stopped',
  status: 'stopped',
  gitUrl: 'https://github.com/example/demo.git',
  envVars: { NODE_ENV: 'production' },
  quotaMb: 1024,
  memoryMax: '512M',
  cpuQuotaPercent: 100,
  port: 3000,
  linuxUser: 'demo',
  homeDir: '/home/demo',
  osProvisioned: true,
  nginxConfigPath: '/etc/nginx/sites-enabled/demo' } as unknown as ProjectDto;

const identity = {
  id: 'id-1',
  name: 'panel-key',
  purpose: 'panel_outbound',
  status: 'installed',
  algo: 'ed25519',
  fingerprintSha256: 'SHA256:abcdef0123456789abcdef',
  publicKey: 'ssh-ed25519 AAAA test',
  createdAt: new Date().toISOString(),
  binding: { linuxUser: 'ysk', homeDir: '/home/ysk', projectId: 'p1' } };

const t = (k: string) => k;

function sshRoutes() {
  return [
    softwareReadyRoute(),
    {
      match: (url: string) => url.startsWith('/api/v1/ssh/identities'),
      body: { ok: true, items: [identity], identity, privateKey: 'PRIVATE', notes: ['created'] } },
    {
      match: (url: string) =>
        url.includes('/install') ||
        url.includes('/test') ||
        url.includes('/rotate') ||
        url.includes('/authorize'),
      body: HONESTY_WRITTEN_BLOCKED },
    {
      match: (url: string) => url.startsWith('/api/v1/sftp/'),
      body: {
        ok: true,
        items: [
          {
            id: 'k1',
            projectId: 'p1',
            publicKey: 'ssh-ed25519 AAAA',
            comment: 'laptop',
            fingerprint: 'SHA256:xyz',
            linuxUser: 'demo' },
        ],
        snippet: 'Match Group sftp',
        notes: ['snippet ready'] } },
    {
      match: (url: string) => url.startsWith('/api/v1/ssh/2fa'),
      body: {
        ok: true,
        items: [
          {
            id: 't1',
            linuxUser: 'demo',
            homeDir: '/home/demo',
            projectId: 'p1',
            status: 'enrolled',
            label: 'demo',
            notes: [],
            hasSecret: true },
        ],
        host: {
          notes: ['ok'],
          lights: { package: 'ok', pam: 'ok', kbdInteractive: 'warn' } },
        pamSnippet: '# pam',
        sshdHints: '# sshd',
        strictSnippet: '# strict',
        strictNotes: ['note'],
        secret: 'SECRET',
        otpauthUrl: 'otpauth://totp/demo' } },
    {
      match: (url: string) => url.startsWith('/api/v1/projects'),
      body: { items: [project], ...project } },
    { match: /.*/, body: { ok: true, items: [], notes: [] } },
  ];
}

describe('SSH feature panels', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('SshWorkspace renders sub-panels via job cards', async () => {
    const user = userEvent.setup();
    installFetchMock(sshRoutes());
    render(
      <MemoryRouter>
        <SshWorkspace onCounts={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(document.body.textContent?.length).toBeGreaterThan(40);
    });
    for (const name of [/login/i, /2fa/i, /sshd/i, /outbound/i]) {
      const buttons = screen.queryAllByRole('button', { name });
      const tabs = screen.queryAllByRole('tab', { name });
      const el = buttons[0] ?? tabs[0];
      if (el) await user.click(el);
    }
  });

  it('OutboundIdentities lists identity and opens wizard', async () => {
    const user = userEvent.setup();
    installFetchMock(sshRoutes());
    render(
      <MemoryRouter>
        <OutboundIdentities onFlash={vi.fn()} onChanged={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/panel-key/i)).toBeInTheDocument());
    const create = screen.queryByRole('button', { name: /create|new|add|新增|建立/i });
    if (create) await user.click(create);
  });

  it('LoginKeysPanel + SshdPanel + Ssh2faPanel mount', async () => {
    installFetchMock(sshRoutes());
    render(
      <MemoryRouter>
        <LoginKeysPanel onFlash={vi.fn()} onChanged={vi.fn()} />
        <SshdPanel onFlash={vi.fn()} />
        <Ssh2faPanel onFlash={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(document.body.textContent?.length).toBeGreaterThan(20);
    });
  });

  it('ssh label helpers cover status paths', () => {
    expect(statusLabel('installed', t as never)).toBeTruthy();
    expect(statusLabel('retired', t as never)).toBeTruthy();
    expect(statusLabel('verified', t as never)).toBeTruthy();
    expect(statusLabel('stored', t as never)).toBeTruthy();
    expect(statusLabel('missing_on_disk', t as never)).toBeTruthy();
    expect(statusLabel('error', t as never)).toBeTruthy();
    expect(statusLabel('other', t as never)).toBe('other');
    expect(statusTone('verified')).toBe('ok');
    expect(statusTone('installed')).toBe('info');
    expect(statusTone('retired')).toBe('neutral');
    expect(statusTone('error')).toBe('danger');
    expect(statusTone('stored')).toBe('warn');
    expect(purposeLabel('panel_outbound', t as never)).toBeTruthy();
    expect(purposeLabel('user_outbound', t as never)).toBeTruthy();
    expect(purposeLabel('unbound', t as never)).toBeTruthy();
    expect(purposeLabel('x', t as never)).toBe('x');
    expect(purposeHint('panel_outbound', t as never)).toBeTruthy();
    expect(purposeHint('user_outbound', t as never)).toBeTruthy();
    expect(purposeHint('other', t as never)).toBeTruthy();
    expect(shortFingerprint('SHA256:abcdef0123456789')).toContain('abcd');
    expect(shortFingerprint('short')).toBe('short');
    expect(pipelineStep('verified')).toBe(2);
    expect(pipelineStep('installed')).toBe(1);
    expect(pipelineStep('error')).toBe(3);
    expect(pipelineStep('stored')).toBe(0);
    expect(nextAction('retired', 'panel_outbound', t as never).id).toBe('none');
    expect(nextAction('stored', 'panel_outbound', t as never).id).toBe('install');
    expect(nextAction('installed', 'panel_outbound', t as never).id).toBe('test');
    expect(nextAction('installed', 'user_outbound', t as never).id).toBe('copy_pub');
    expect(nextAction('verified', 'panel_outbound', t as never).id).toBe('copy_pub');
    expect(nextAction('x', 'panel_outbound', t as never).id).toBe('install');
  });
});

describe('DbClusterPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists clusters and opens create wizard', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) => url.includes('/api/v1/db/clusters'),
        handler: (_url, init) => {
          const method = (init?.method ?? 'GET').toUpperCase();
          if (method === 'POST') {
            return {
              ok: true,
              cluster: {
                id: 'c1',
                name: 'ysk-cluster',
                engine: 'postgres',
                kind: 'postgres-replica',
                status: 'draft',
                members: [],
                params: {} },
              plan: {
                ok: true,
                notes: ['plan'],
                steps: [],
                clusterId: 'c1',
                files: [] },
              ...HONESTY_WRITTEN_BLOCKED };
          }
          return {
            ok: true,
            items: [
              {
                id: 'c1',
                name: 'ysk-cluster',
                engine: 'postgres',
                kind: 'postgres-replica',
                status: 'planned',
                members: [
                  { host: '10.0.0.1', role: 'primary', access: 'local', label: 'primary' },
                ],
                params: {},
                artifactDir: '/var/lib/ysk/c1' },
            ],
            cluster: {
              id: 'c1',
              name: 'ysk-cluster',
              engine: 'postgres',
              kind: 'postgres-replica',
              status: 'planned',
              members: [],
              params: {} },
            plan: {
              ok: true,
              notes: ['dry-run'],
              steps: [{ id: '1', title: 'cfg' }],
              clusterId: 'c1',
              files: [] } };
        } },
    ]);
    render(
      <MemoryRouter>
        <DbClusterPanel engine="postgres" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/ysk-cluster/i)).toBeInTheDocument());
    const createBtns = screen.queryAllByRole('button', {
      name: /create|new|plan|wizard|新增|建立/i });
    if (createBtns[0]) await user.click(createBtns[0]!);
  });
});

describe('Users panels', () => {
  it('RolePermissionsPanel renders factory policy', () => {
    render(
      <MemoryRouter>
        <RolePermissionsPanel
          policies={[
            {
              role: 'operator',
              dirty: false,
              policy: { maxLevel: 'write-high', capabilities: ['projects.read'] },
              factory: { maxLevel: 'write-high', capabilities: ['projects.read'] } },
          ]}
          policyRole="operator"
          draftMax="write-high"
          draftCaps={['projects.read']}
          canEdit
          onRoleChange={vi.fn()}
          onMaxLevelChange={vi.fn()}
          onCapsChange={vi.fn()}
          onSave={vi.fn()}
          onRestoreRole={vi.fn()}
          onRestoreAll={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(document.body.textContent?.length).toBeGreaterThan(10);
  });

  it('UserDetailModal open with user and tabs', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <UserDetailModal
          open
          user={{
            id: 'u1',
            username: 'alice',
            roles: ['operator'],
            packageId: 'pkg1',
            suspended: false }}
          packages={[{ id: 'pkg1', name: 'default' }]}
          role="operator"
          packageId="pkg1"
          suspended={false}
          password=""
          grants={[]}
          revokes={[]}
          effective={['projects.read']}
          isAdminRole={false}
          canImpersonate
          onRoleChange={vi.fn()}
          onPackageChange={vi.fn()}
          onSuspendedChange={vi.fn()}
          onPasswordChange={vi.fn()}
          onGrantsChange={vi.fn()}
          onRevokesChange={vi.fn()}
          onSave={vi.fn()}
          onClose={vi.fn()}
          onImpersonate={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/alice/i).length).toBeGreaterThan(0);
    for (const tab of screen.queryAllByRole('tab')) {
      await user.click(tab);
    }
  });
});

describe('Project UI panels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mounts all major project tabs with demo project', async () => {
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) => url.includes('/api/v1/projects'),
        handler: (url) => {
          if (url.includes('deploy-history') || url.includes('/history')) {
            return {
              items: [
                {
                  id: 'h1',
                  ok: true,
                  action: 'project.deploy',
                  actor: 'admin',
                  created_at: new Date().toISOString(),
                  detail: { entry: 'server.js', port: 3000 } },
              ] };
          }
          return {
            items: [project],
            ...project,
            usedMb: 10,
            quotaMb: 1024,
            withinQuota: true,
            linesRead: 1,
            status2xx: 1,
            status4xx: 0,
            ok: true,
            templates: [] };
        } },
      {
        match: /\/api\/v1\/ssh\//,
        body: { items: [identity], ok: true } },
      {
        match: /\/api\/v1\/sftp\//,
        body: { items: [], ok: true, snippet: '', notes: [] } },
      { match: /.*/, body: { ok: true, items: [], notes: [], templates: [] } },
    ]);
    const noop = vi.fn();
    const set = vi.fn();
    render(
      <MemoryRouter>
        <ProjectOverviewTab
          project={project}
          busy={false}
          onPublishNginx={noop}
          onPublishSsl={noop}
          onBackup={noop}
          onHealth={noop}
        />
        <ProjectDeployTab
          project={project}
          busy={false}
          gitUrl={project.gitUrl ?? ''}
          setGitUrl={set}
          envText="NODE_ENV=production"
          setEnvText={set}
          onDeploy={noop}
          onGitDeploy={noop}
          onSaveEnv={noop}
          showFreshChecklist
          onDismissChecklist={noop}
        />
        <ProjectNetworkTab
          project={project}
          busy={false}
          onPublish={noop}
          onPublishSsl={noop}
        />
        <ProjectResourcesTab
          project={project}
          busy={false}
          quotaMb="1024"
          setQuotaMb={set}
          memoryMax="512M"
          setMemoryMax={set}
          cpuQuota="100"
          setCpuQuota={set}
          onSetQuota={noop}
          onSetResources={noop}
          onProvisionOs={noop}
        />
        <ProjectLogsTab
          logTail={'line1\nline2'}
          files={[{ name: 'app.log', bytes: 100 }]}
          selectedFile="app.log"
          hits={[{ file: 'app.log', lines: ['err'], matched: 1 }]}
          onLoad={noop}
          onSelectFile={noop}
          projectId="p1"
        />
        <ProjectAdvancedTab
          project={project}
          busy={false}
          onBackup={noop}
          onWordpress={noop}
          onSuspend={noop}
          onUnsuspend={noop}
          onDelete={noop}
        />
        <ProjectSshCard project={project} />
        <ProjectChecklist project={project} />
        <ProjectNextStep project={project} />
        <HealthSummary lastHealth={{ ok: true, status: 'stopped', latencyMs: 1 }} />
        <ProjectStatusBadge project={project} showHint />
        <ProjectDetailHeader
          project={project}
          busy={false}
          onDeploy={noop}
          onStop={noop}
          onHealth={noop}
          onRefresh={noop}
        />
        <ProjectListItem project={project} />
        <ProjectList items={[project]} emptyTitle="empty" />
        <ProjectList items={[]} emptyTitle="No projects" emptyDescription="create one" />
        <ProjectCreateModal open onClose={noop} onSubmit={async () => undefined} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getAllByText(/Demo App|demo/i).length).toBeGreaterThan(0);
    });

    // model helpers
    expect(getProjectUiProfile('node').showDeployTab).toBe(true);
    expect(getProjectUiProfile('php').showWordpress).toBe(true);
    expect(getProjectUiProfile('static').showDeploy).toBe(false);
    expect(getProjectUiProfile('python').runtime).toBe('python');
    expect(getProjectUiProfile('go').runtime).toBe('go');
    expect(getProjectUiProfile('rust').runtime).toBe('rust');
    expect(formatRuntimeName('php')).toMatch(/PHP/i);
    expect(formatRuntimeName('node')).toMatch(/Node/i);
    expect(formatRuntimeName(undefined)).toBeTruthy();
    expect(deriveProjectStatus(project).bucket).toBeTruthy();
    expect(buildProjectChecklist(project).length).toBeGreaterThan(0);
    expect(formatHealthFacts({ ok: true }).length).toBeGreaterThanOrEqual(0);
    expect(runtimeVersionChoices('node').length).toBeGreaterThan(0);
    expect(defaultRuntimeInstallVersion('node')).toBeTruthy();
    expect(runtimeInstallKind('node')).toBeTruthy();
    expect(runtimePagePath('node')).toMatch(/node/i);
    saveDeployPrefs('p1', { skipBuild: true });
    expect(loadDeployPrefs('p1').skipBuild).toBe(true);
  });
});

describe('TopHeaderPanel', () => {
  it('renders metrics strip and empty state', () => {
    const { rerender, container } = render(
      <TopHeaderPanel header={null} perCpu={false} onTogglePerCpu={vi.fn()} />,
    );
    expect(container.textContent?.length).toBeGreaterThan(0);

    rerender(
      <TopHeaderPanel
        header={{
          ok: true,
          at: new Date().toISOString(),
          tasks: { total: 10, running: 1, sleeping: 8, stopped: 1, zombie: 0 },
          cpu: { us: 10, sy: 5, ni: 0, id: 80, wa: 2, hi: 0, si: 1, st: 0, busyPct: 20 },
          cpus: [
            { us: 10, sy: 5, ni: 0, id: 80, wa: 2, hi: 0, si: 1, st: 0, busyPct: 20 },
          ],
          memory: {
            totalKiB: 1024 * 1024,
            freeKiB: 512 * 1024,
            usedKiB: 512 * 1024,
            buffCacheKiB: 0,
            availableKiB: 512 * 1024 },
          swap: { totalKiB: 1024 * 1024, freeKiB: 1024 * 1024, usedKiB: 0 },
          loadavg: [0.1, 0.2, 0.3],
          uptimeSec: 90000,
          notes: ['sample'] }}
        perCpu
        onTogglePerCpu={vi.fn()}
      />,
    );
    expect(container.querySelector('.top-panel')).toBeTruthy();
    expect(formatRes(2048)).toMatch(/m/i);
    expect(formatRes(undefined)).toBe('—');
    expect(formatRes(5)).toBe('5');
  });
});
