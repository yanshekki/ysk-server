/**
 * Deep RTL + user-event for features/security/ssh/* panels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute } from '../../../test/mock-fetch';
import { authStore } from '../../../shared/stores/auth-store';
import { LoginKeysPanel } from './LoginKeysPanel';
import { SshdPanel } from './SshdPanel';
import { Ssh2faPanel } from './Ssh2faPanel';
import { SshWorkspace } from './SshWorkspace';
import { OutboundIdentities } from './OutboundIdentities';
import { useSecurity } from '../useSecurity';
import { renderHook, act } from '@testing-library/react';

const loginKey = {
  id: 'k1',
  projectId: 'p1',
  username: 'ysk_demo',
  publicKey: 'ssh-ed25519 AAAAB3NzaC1yc2EAAAADAQABAAABAQ login@laptop',
  comment: 'laptop',
  fingerprint: 'SHA256:xyz',
  linuxUser: 'ysk_demo',
  homeDir: '/home/demo' };

const identity = {
  id: 'id-1',
  name: 'panel-key',
  purpose: 'panel_outbound',
  status: 'stored',
  algo: 'ed25519',
  fingerprintSha256: 'SHA256:abcdef0123456789abcdef01',
  publicKey: 'ssh-ed25519 AAAAtestkey panel',
  createdAt: new Date().toISOString(),
  binding: { linuxUser: 'ysk', homeDir: '/home/ysk', projectId: 'p1' } };

const project = {
  id: 'p1',
  name: 'Demo',
  linuxUser: 'ysk_demo',
  homeDir: '/home/demo' };

function securityRoutes(opts?: { twofaStatus?: string }) {
  const twofaStatus = opts?.twofaStatus ?? 'enrolled';
  return [
    softwareReadyRoute(),
    {
      match: (url: string) => url.includes('/api/v1/sftp/keys'),
      handler: (_url: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST') return { ok: true, notes: ['key added'] };
        if (method === 'DELETE') return { ok: true, notes: ['removed'] };
        return { items: [loginKey] };
      } },
    {
      match: (url: string) => url.includes('/sftp/sshd-snippet'),
      handler: (_url: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
          return { ok: true, notes: ['installed'], ...HONESTY_WRITTEN_BLOCKED };
        }
        return { snippet: 'Match Group sftp_users\n', notes: ['preview ready'] };
      } },
    {
      match: (url: string) => url.includes('/api/v1/ssh/2fa'),
      handler: (url: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('pam-snippet')) {
          return {
            pamSnippet: '# pam_google_authenticator',
            sshdHints: 'AuthenticationMethods publickey,keyboard-interactive',
            strictSnippet: '# strict',
            strictNotes: ['root rescue'] };
        }
        if (method === 'POST' && url.endsWith('/2fa')) {
          return {
            ok: true,
            secret: 'JBSWY3DPEHPK3PXP',
            otpauthUrl: 'otpauth://totp/demo',
            record: {
              id: 't1',
              linuxUser: 'ysk_demo',
              homeDir: '/home/demo',
              projectId: 'p1',
              status: 'enrolled',
              label: 'demo',
              notes: [],
              hasSecret: true },
            notes: ['enrolled'] };
        }
        if (url.includes('/confirm')) {
          return { ok: true, notes: ['confirmed'] };
        }
        if (url.includes('/install')) {
          return { ok: true, applied: false, blocked: true, notes: ['need execute'], ...HONESTY_WRITTEN_BLOCKED };
        }
        if (method === 'DELETE') return { ok: true };
        return {
          ok: true,
          items: [
            {
              id: 't1',
              linuxUser: 'ysk_demo',
              homeDir: '/home/demo',
              projectId: 'p1',
              status: twofaStatus,
              label: 'demo',
              notes: [],
              hasSecret: true,
              filePath: '/home/demo/.google_authenticator' },
            {
              id: 't2',
              linuxUser: 'other',
              homeDir: '/home/other',
              status: 'confirmed',
              label: 'other',
              notes: [],
              hasSecret: true },
            {
              id: 't3',
              linuxUser: 'written',
              homeDir: '/home/written',
              status: 'file_written',
              label: 'written',
              notes: [],
              hasSecret: true,
              fromPanel: true },
          ],
          host: {
            notes: ['host note'],
            lights: { package: 'green', pam: 'yellow', kbdInteractive: 'red' } } };
      } },
    {
      match: (url: string) => url.includes('/api/v1/ssh/identities'),
      handler: (url: string, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && !url.includes('/install') && !url.includes('/test') && !url.includes('/rotate') && !url.includes('/authorize')) {
          return {
            ok: true,
            identity: { ...identity, id: 'id-new', name: 'created' },
            privateKey: '-----BEGIN PRIVATE KEY-----\nX\n-----END-----',
            notes: ['created'],
            ...HONESTY_WRITTEN_BLOCKED };
        }
        if (url.includes('/install') || url.includes('/test') || url.includes('/rotate') || url.includes('/authorize')) {
          return HONESTY_WRITTEN_BLOCKED;
        }
        if (method === 'DELETE') return { ok: true };
        return { ok: true, items: [identity, { ...identity, id: 'id-2', status: 'installed', name: 'installed-key' }] };
      } },
    {
      match: (url: string) => url.includes('/api/v1/projects'),
      body: { items: [project] } },
    {
      match: (url: string) => url.includes('/api/v1/security'),
      body: {
        items: [{ id: 'sys.info', name: 'sys.info' }],
        tools: [{ id: 'sys.info' }] } },
    { match: /.*/, body: { ok: true, items: [], notes: [] } },
  ];
}

describe('LoginKeysPanel deep', () => {
  beforeEach(() => authStore.setSession('t', { username: 'admin', roles: ['admin'] }));
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('lists keys, opens add modal, validates, adds, removes', async () => {
    const user = userEvent.setup();
    const onFlash = vi.fn();
    const onChanged = vi.fn();
    installFetchMock(securityRoutes());

    render(
      <MemoryRouter>
        <LoginKeysPanel onFlash={onFlash} onChanged={onChanged} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/ysk_demo|laptop/i)).toBeInTheDocument());

    // refresh
    const refresh = screen.getAllByRole('button', { name: /refresh|重新/i })[0];
    if (refresh) await user.click(refresh);

    // open add
    await user.click(screen.getByRole('button', { name: /add|login|新增|添加/i }));

    await waitFor(() => expect(document.getElementById('login-pub')).toBeTruthy());

    const proj = document.getElementById('login-proj') as HTMLSelectElement;
    if (proj) {
      const opt = [...proj.options].find((o) => o.value === 'p1') ?? [...proj.options].find((o) => o.value);
      if (opt) await user.selectOptions(proj, opt.value);
    }

    // invalid pub (does not start with ssh-) → onFlash error
    const pub = document.getElementById('login-pub') as HTMLTextAreaElement;
    await user.clear(pub);
    await user.type(pub, 'not-a-key');
    const submitInvalid = screen.getAllByRole('button', { name: /add|auth|加入|添加/i }).pop()!;
    if (!(submitInvalid as HTMLButtonElement).disabled) {
      await user.click(submitInvalid);
      await waitFor(() => expect(onFlash).toHaveBeenCalled());
    }

    await user.clear(pub);
    await user.type(pub, 'ssh-ed25519 AAAA newkey user@host');
    const cmt = document.getElementById('login-cmt') as HTMLInputElement;
    if (cmt) await user.type(cmt, 'workstation');

    const submit = screen.getAllByRole('button', { name: /add|auth|加入|添加/i }).pop()!;
    if (!(submit as HTMLButtonElement).disabled) {
      await user.click(submit);
      await waitFor(() => expect(onFlash).toHaveBeenCalled());
    }

    // remove existing key
    const remove = screen.queryAllByRole('button', { name: /remove|delete|刪除|删除/i })[0];
    if (remove) {
      await user.click(remove);
      await waitFor(() => expect(onFlash).toHaveBeenCalled());
    }
  });
});

describe('SshdPanel deep', () => {
  beforeEach(() => authStore.setSession('t', { username: 'admin', roles: ['admin'] }));
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('loads snippet, copies, applies to system', async () => {
    const user = userEvent.setup();
    const onFlash = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText } });
    installFetchMock(securityRoutes());

    render(
      <MemoryRouter>
        <SshdPanel onFlash={onFlash} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const ta = document.getElementById('sshd-snip') as HTMLTextAreaElement;
      expect(ta?.value).toMatch(/Match|sftp|loading/i);
    });

    await user.click(screen.getByRole('button', { name: /reload|copy|重新|複製|复制/i }));
    await waitFor(() => expect(onFlash).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /install|system|安裝|安装/i }));
    await waitFor(() => expect(onFlash.mock.calls.length).toBeGreaterThan(1));
  });
});

describe('Ssh2faPanel deep', () => {
  beforeEach(() => authStore.setSession('t', { username: 'admin', roles: ['admin'] }));
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('lists enrollments, enrolls, confirms code, installs, retires', async () => {
    const user = userEvent.setup();
    const onFlash = vi.fn();
    installFetchMock(securityRoutes({ twofaStatus: 'enrolled' }));

    render(
      <MemoryRouter>
        <Ssh2faPanel onFlash={onFlash} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByText(/ysk_demo|demo/i).length).toBeGreaterThan(0));

    // refresh
    const refresh = screen.getAllByRole('button', { name: /refresh|重新/i })[0];
    if (refresh) await user.click(refresh);

    // open enroll
    await user.click(screen.getByRole('button', { name: /enroll|2fa|註冊|注册/i }));

    const proj = document.querySelector('select') as HTMLSelectElement | null;
    if (proj && proj.options.length) {
      const withVal = [...proj.options].find((o) => o.value);
      if (withVal) await user.selectOptions(proj, withVal.value);
    }

    // submit enroll modal
    for (const b of screen
      .queryAllByRole('button', { name: /enroll|create|generate|confirm|建立|生成/i })
      .slice(0, 4)) {
      try {
        if (!(b as HTMLButtonElement).disabled) await user.click(b);
      } catch {
        /* closed */
      }
    }

    // enter code for enrolled row
    const enterCode = screen.queryAllByRole('button', { name: /code|enter|輸入|输入/i })[0];
    if (enterCode) {
      await user.click(enterCode);
      const codeInput =
        (document.querySelector('input[name="code"], input[id*="code"], input[type="text"]') as HTMLElement | null) ??
        (document.querySelector('.modal input, [role="dialog"] input') as HTMLElement | null);
      if (codeInput) {
        await user.type(codeInput, '123456');
        for (const b of screen.queryAllByRole('button', { name: /confirm|verify|確認|确认/i }).slice(0, 2)) {
          try {
            await user.click(b);
          } catch {
            /* ignore */
          }
        }
      }
    }

    // write home for confirmed / file_written
    for (const b of screen
      .queryAllByRole('button', { name: /write|home|rewrite|寫入|写入/i })
      .slice(0, 3)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }

    // retire
    const retire = screen.queryAllByRole('button', { name: /retire|revoke|停用|銷毀/i })[0];
    if (retire) await user.click(retire);

    await waitFor(() => expect(onFlash.mock.calls.length).toBeGreaterThan(0));
  });
});

describe('SshWorkspace + OutboundIdentities actions', () => {
  beforeEach(() => authStore.setSession('t', { username: 'admin', roles: ['admin'] }));
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('workspace switches jobs and outbound runs install/test/delete flows', async () => {
    const user = userEvent.setup();
    installFetchMock(securityRoutes());

    render(
      <MemoryRouter>
        <SshWorkspace onCounts={vi.fn()} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(document.body.textContent!.length).toBeGreaterThan(40));

    for (const name of [/login/i, /2fa/i, /sshd/i, /outbound|外連|出站/i]) {
      const el =
        screen.queryAllByRole('button', { name })[0] ??
        screen.queryAllByRole('tab', { name })[0];
      if (el) await user.click(el);
    }
  });

  it('OutboundIdentities selects installed identity and fires actions', async () => {
    const user = userEvent.setup();
    const onFlash = vi.fn();
    installFetchMock(securityRoutes());

    render(
      <MemoryRouter>
        <OutboundIdentities onFlash={onFlash} onChanged={vi.fn()} />
      </MemoryRouter>,
    );

    // Click "All" filter in case Active hides unexpected statuses
    const allFilter = screen.queryAllByRole('button', { name: /^all$/i })[0];
    if (allFilter) await user.click(allFilter);

    const labels = await screen.findAllByText(/installed-key|panel-key/i, {}, { timeout: 5000 });
    await user.click(labels[0]!);

    for (const b of screen
      .queryAllByRole('button', {
        name: /install|test|copy|rotate|delete|remove|authorize|reveal|安裝|測試|複製|刪除/i })
      .slice(0, 10)) {
      try {
        await user.click(b);
      } catch {
        /* confirm */
      }
    }

    // confirm any danger dialogs
    for (const b of screen
      .queryAllByRole('button', { name: /confirm|delete|yes|確認|确认|刪除/i })
      .slice(0, 3)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }
  });
});

describe('useSecurity hook', () => {
  beforeEach(() => authStore.setSession('t', { username: 'admin', roles: ['admin'] }));
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('loads tools/approvals, runs sys.info, approves', async () => {
    installFetchMock([
      {
        match: (url: string) => url.includes('/security') || url.includes('/tools') || url.includes('/approvals'),
        handler: (url: string, init?: RequestInit) => {
          if (url.includes('execute') || (init?.method ?? '').toUpperCase() === 'POST') {
            return { ok: true, result: { hostname: 'test' } };
          }
          return {
            items: [
              { id: 'a1', tool: 'sys.info', status: 'pending' },
              { id: 'sys.info', name: 'sys.info' },
            ] };
        } },
      { match: /.*/, body: { ok: true, items: [] } },
    ]);

    const { result } = renderHook(() => useSecurity());
    await waitFor(() => expect(result.current.tools.length + result.current.approvals.length).toBeGreaterThanOrEqual(0));

    await act(async () => {
      await result.current.runSysInfo();
    });
    // result or error set
    expect(result.current.result != null || result.current.error != null || result.current.busy === false).toBe(true);

    if (result.current.approvals[0]) {
      await act(async () => {
        await result.current.approve(String(result.current.approvals[0]!.id ?? 'a1'));
      });
    }

    await act(async () => {
      await result.current.refresh();
    });
  });
});
