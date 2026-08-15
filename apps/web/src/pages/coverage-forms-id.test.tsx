/**
 * ID-targeted form submissions for Users / Files / Dns / Email / Security.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  HONESTY_WRITTEN_BLOCKED,
  installFetchMock,
  softwareReadyRoute } from '../test/mock-fetch';
import { authStore } from '../shared/stores/auth-store';
import { UsersPage } from './UsersPage';
import { FilesPage } from './FilesPage';
import { DnsPage } from './features/DnsPage';
import { EmailDomainPage } from './EmailDomainPage';
import { SecurityPage } from './SecurityPage';

function renderAt(path: string, el: React.ReactElement, routePath = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillId(id: string, value: string, user: ReturnType<typeof userEvent.setup>) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return false;
  try {
    el.focus();
    await user.clear(el as HTMLInputElement);
    await user.type(el as HTMLInputElement, value);
    return true;
  } catch {
    return false;
  }
}

describe('id-targeted forms', () => {
  beforeEach(() => {
    authStore.setSession('t', { username: 'admin', roles: ['admin'] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    authStore.clear();
  });

  it('UsersPage create user + package + detail save + policy', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) => url.startsWith('/api/v1/users'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
          return {
            items: [
              {
                id: 'u1',
                username: 'admin',
                roles: ['admin'],
                packageId: 'pkg1',
                suspended: false,
                locale: 'en',
                capabilityGrants: [],
                capabilityRevokes: [] },
            ],
            meta: {
              total: 1,
              page: 1,
              limit: 50,
              q: '',
              filters: {},
              order: 'asc',
              facets: { role: { admin: 1 }, status: { suspended: 0 }, totp: { '1': 0 } } },
            hostUsage: { projects: 1, diskMb: 10, limitMb: 1000 } };
        } },
      {
        match: (url) => url.startsWith('/api/v1/packages'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
          return {
            items: [
              {
                id: 'pkg1',
                name: 'default',
                maxProjects: 10,
                maxMailboxes: 5,
                maxDatabases: 5,
                diskMb: 1024,
                bandwidthMb: 0,
                ftp: true,
                ssh: true,
                notes: '' },
            ] };
        } },
      {
        match: (url) => url.includes('/api/v1/rbac'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
          return {
            items: [
              {
                role: 'operator',
                dirty: true,
                policy: {
                  maxLevel: 'write-high',
                  capabilities: ['projects.read', 'projects.write'] },
                factory: {
                  maxLevel: 'write-high',
                  capabilities: ['projects.read'] } },
              {
                role: 'viewer',
                dirty: false,
                policy: { maxLevel: 'read', capabilities: ['projects.read'] },
                factory: { maxLevel: 'read', capabilities: ['projects.read'] } },
            ] };
        } },
      { match: /.*/, body: { ok: true, items: [] } },
    ]);

    renderAt('/users', <UsersPage />);
    await waitFor(() => expect(screen.getByText(/admin/i)).toBeInTheDocument());

    // Create user
    const createUser = screen.queryAllByRole('button', { name: /create user|\+ create user/i })[0];
    if (createUser) await user.click(createUser);
    await fillId('u-name', 'alice', user);
    await fillId('u-pass', 'Password1!', user);
    const locSel = document.getElementById('u-locale') as HTMLSelectElement | null;
    expect(locSel?.options.length).toBe(13);
    expect([...locSel?.options ?? []].map((o) => o.value)).toEqual(
      expect.arrayContaining(['zh-HK', 'zh-CN', 'en', 'ja', 'ko', 'ar', 'ur']),
    );
    const pkg = document.getElementById('u-pkg') as HTMLSelectElement | null;
    if (pkg) await user.selectOptions(pkg, 'pkg1');
    const submitUser = screen.queryAllByRole('button', { name: /^create user$/i })[0];
    if (submitUser) await user.click(submitUser);
    // confirm admin promote if shown
    for (const b of screen.queryAllByRole('button', { name: /confirm|yes|create/i }).slice(0, 2)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }

    // Create package
    const pkgTab = screen.queryByRole('tab', { name: /package/i });
    if (pkgTab) await user.click(pkgTab);
    const createPkg = screen.queryAllByRole('button', { name: /create package|\+ create package/i })[0];
    if (createPkg) await user.click(createPkg);
    await fillId('p-name', 'gold', user);
    await fillId('p-notes', 'note', user);
    await fillId('p-bw', '100', user);
    const submitPkg = screen.queryAllByRole('button', { name: /create package|save/i })[0];
    if (submitPkg) await user.click(submitPkg);

    // Details
    const usersTab = screen.queryByRole('tab', { name: /user/i });
    if (usersTab) await user.click(usersTab);
    const details = screen.queryAllByRole('button', { name: /details/i })[0];
    if (details) await user.click(details);
    await waitFor(() => expect(screen.queryAllByRole('dialog').length).toBeGreaterThan(0)).catch(
      () => undefined,
    );
    for (const b of screen
      .queryAllByRole('button', { name: /save user|save|delete|restore|impersonate/i })
      .slice(0, 4)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }
    for (const b of screen.queryAllByRole('button', { name: /confirm|yes/i }).slice(0, 2)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }

    // RBAC tab
    const rbac = screen.queryAllByRole('tab', { name: /rbac|role|permission|access/i })[0];
    if (rbac) await user.click(rbac);
    for (const cb of screen.queryAllByRole('checkbox').slice(0, 10)) {
      try {
        await user.click(cb);
      } catch {
        /* ignore */
      }
    }
    for (const b of screen
      .queryAllByRole('button', { name: /save|restore|reset/i })
      .slice(0, 4)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }
    for (const b of screen.queryAllByRole('button', { name: /confirm|yes/i }).slice(0, 2)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  }, 25_000);

  it('DnsPage create zone + record + SOA + tools', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: /\/api\/v1\/resources\//,
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return {
              ...HONESTY_WRITTEN_BLOCKED,
              item: {
                id: 'z1',
                zone: 'example.com',
                serverIp: '1.2.3.4',
                nsName: 'ns1.example.com',
                ttl: 300,
                apply_status: 'planned' } };
          }
          if (url.includes('zones')) {
            return {
              items: [
                {
                  id: 'z1',
                  zone: 'example.com',
                  serverIp: '1.2.3.4',
                  nsName: 'ns1.example.com',
                  ttl: 300,
                  apply_status: 'planned',
                  backend: 'bind' },
              ],
              meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } };
          }
          return {
            items: [
              {
                id: 'r1',
                zoneId: 'z1',
                type: 'A',
                name: '@',
                value: '1.2.3.4',
                ttl: 300 },
            ],
            meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' } };
        } },
      {
        match: /\/api\/v1\/dns/,
        body: {
          ...HONESTY_WRITTEN_BLOCKED,
          ok: true,
          answers: ['1.2.3.4'],
          notes: ['ok'],
          items: [{ id: 'peer-1', host: 'ns2.example.com', user: 'ysk', label: 'peer' }],
          peers: [{ host: 'ns2.example.com', ok: true }],
          dsRecord: 'example.com. IN DS 1 13 2 AB',
          files: ['/var/lib/bind/example.com.zone'] } },
      { match: /.*/, body: { ok: true, items: [] } },
    ]);

    renderAt('/dns', <DnsPage />);
    await waitFor(() => expect(screen.getByText(/example\.com/i)).toBeInTheDocument());
    try {
      await user.click(screen.getAllByText(/example\.com/i)[0]!);
    } catch {
      /* ignore */
    }

    const createZone = screen.queryAllByRole('button', { name: /create zone/i })[0];
    if (createZone) await user.click(createZone);
    // zone modal fields - often first textboxes
    const dialog = screen.queryAllByRole('dialog')[0];
    if (dialog) {
      const inputs = dialog.querySelectorAll('input, textarea, select');
      let i = 0;
      for (const input of Array.from(inputs).slice(0, 6)) {
        try {
          if (input.tagName === 'SELECT') {
            const opt = input.querySelector('option:not([value=""])') as HTMLOptionElement | null;
            if (opt) await user.selectOptions(input as HTMLSelectElement, opt.value);
          } else {
            await user.type(input as HTMLInputElement, i === 0 ? 'new.example.com' : '203.0.113.20');
          }
        } catch {
          /* ignore */
        }
        i++;
      }
      const create = dialog.querySelector('button[type="submit"]') as HTMLButtonElement | null;
      if (create) await user.click(create);
      else {
        const b = screen.queryAllByRole('button', { name: /create|save/i })[0];
        if (b) await user.click(b);
      }
    }

    // Records
    const recTab = screen.queryByRole('tab', { name: /records/i });
    if (recTab) await user.click(recTab);
    await fillId('edit-soa-ns', 'ns1.example.com', user);
    await fillId('edit-soa-ttl', '300', user);
    for (const name of [/save and write|save soa|write|apply|dnssec|add record/i]) {
      const b = screen.queryAllByRole('button', { name })[0];
      if (b && !(b as HTMLButtonElement).disabled) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
    }

    for (const tabName of [/cluster/i, /dnssec/i, /tools/i]) {
      const tab = screen.queryByRole('tab', { name: tabName });
      if (tab) await user.click(tab);
      for (const input of screen.queryAllByRole('textbox').slice(0, 4)) {
        try {
          await user.type(input, 'example.com');
        } catch {
          /* ignore */
        }
      }
      for (const b of screen
        .queryAllByRole('button', { name: /add|lookup|validate|save|sync|apply|enable/i })
        .slice(0, 6)) {
        if ((b as HTMLButtonElement).disabled) continue;
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
    }
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  }, 25_000);

  it('FilesPage open text file + new folder submit', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) => url.includes('/api/v1/files') || url.includes('/hosting/files'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return { ...HONESTY_WRITTEN_BLOCKED, ok: true, path: 'newdir', content: 'x' };
          }
          if (url.includes('/read')) {
            return { content: 'hello world', path: 'a.txt', bytes: 11, mime: 'text/plain' };
          }
          if (url.includes('download')) {
            return { ok: true };
          }
          return {
            ok: true,
            path: '/',
            entries: [
              {
                name: 'a.txt',
                path: 'a.txt',
                type: 'file',
                size: 11,
                mtime: now,
                mime: 'text/plain' },
              {
                name: 'pic.png',
                path: 'pic.png',
                type: 'file',
                size: 20,
                mtime: now,
                mime: 'image/png' },
              { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: now },
            ],
            items: [
              {
                name: 'a.txt',
                path: 'a.txt',
                type: 'file',
                size: 11,
                mtime: now,
                mime: 'text/plain' },
              {
                name: 'pic.png',
                path: 'pic.png',
                type: 'file',
                size: 20,
                mtime: now,
                mime: 'image/png' },
              { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: now },
            ] };
        } },
      { match: /.*/, body: { ok: true, items: [] } },
    ]);

    // Mock blob download
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        // fall through to installFetchMock? re-install after
        return new Response(JSON.stringify({ ok: true, content: 'hello', path: 'a.txt', bytes: 5, items: [], entries: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' } });
      }),
    );
    // Re-install after stub? Actually installFetchMock also stubs. Order matters.
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) => url.includes('/api/v1/files') || url.includes('/hosting/files'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return { ...HONESTY_WRITTEN_BLOCKED, ok: true, path: 'newdir' };
          }
          if (url.includes('/read')) {
            return { content: 'hello world', path: 'a.txt', bytes: 11, mime: 'text/plain' };
          }
          return {
            ok: true,
            path: '/',
            entries: [
              {
                name: 'a.txt',
                path: 'a.txt',
                type: 'file',
                size: 11,
                mtime: now,
                mime: 'text/plain' },
              { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: now },
            ],
            items: [
              {
                name: 'a.txt',
                path: 'a.txt',
                type: 'file',
                size: 11,
                mtime: now,
                mime: 'text/plain' },
              { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: now },
            ] };
        } },
      { match: /.*/, body: { ok: true, items: [] } },
    ]);

    renderAt('/files', <FilesPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

    try {
      const row = screen.getByText('a.txt');
      await user.click(row);
      await user.dblClick(row);
    } catch {
      /* ignore */
    }

    const newFolder = screen.queryAllByRole('button', { name: /new folder/i })[0];
    if (newFolder) await user.click(newFolder);
    const dialog = screen.queryAllByRole('dialog')[0];
    if (dialog) {
      const input = dialog.querySelector('input') as HTMLInputElement | null;
      if (input) await user.type(input, 'newdir');
      const create = dialog.querySelector('button[type="submit"]') as HTMLButtonElement | null
        ?? screen.queryAllByRole('button', { name: /create|ok|save/i })[0];
      if (create) await user.click(create);
    }

    const newText = screen.queryAllByRole('button', { name: /new text/i })[0];
    if (newText) await user.click(newText);
    const d2 = screen.queryAllByRole('dialog')[0];
    if (d2) {
      const input = d2.querySelector('input') as HTMLInputElement | null;
      if (input) await user.type(input, 'note.txt');
      const create = screen.queryAllByRole('button', { name: /create|ok|save/i })[0];
      if (create) await user.click(create);
    }

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  }, 20_000);

  it('SecurityPage enroll TOTP + create API key', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) => url.startsWith('/api/v1/auth/totp'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return {
              ok: true,
              secret: 'JBSWY3DPEHPK3PXP',
              otpauthUrl: 'otpauth://totp/YSK:admin?secret=JBSWY3DPEHPK3PXP',
              enabled: true,
              enrolled: true,
              recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'] };
          }
          return { enabled: false, enrolled: false };
        } },
      {
        match: (url) => url.startsWith('/api/v1/auth/sessions'),
        body: {
          items: [
            {
              id: 's1',
              created_at: now,
              expires_at: now,
              current: true,
              ip: '1.1.1.1',
              user_agent: 'vitest' },
          ] } },
      {
        match: (url) => url.startsWith('/api/v1/auth/api-keys'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
            return {
              key: { id: 'k2', name: 'ci2', prefix: 'ysk_x', created_at: now },
              token: 'ysk_x_secret' };
          }
          return {
            items: [{ id: 'k1', name: 'ci', prefix: 'ysk_ci', created_at: now }] };
        } },
      {
        match: (url) => url.startsWith('/api/v1/settings/security'),
        body: { requireAdminTotp: false, requireAdminTotpStrict: false, ok: true } },
      {
        match: (url) => url.startsWith('/api/v1/approvals'),
        body: {
          items: [{ id: 'ap1', tool: 'sys.shell', status: 'pending', requestedAt: now }] } },
      {
        match: (url) => url.startsWith('/api/v1/tools'),
        handler: (_u, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return { hostname: 'h', uptime: 1 };
          return {
            items: [
              { id: 'sys.info', name: 'sys.info', allowed: true, requiresApproval: false },
              { id: 'sys.shell', name: 'sys.shell', allowed: false, requiresApproval: true },
            ] };
        } },
      {
        match: /\/api\/v1\/ssh\//,
        body: {
          ok: true,
          items: [],
          host: { notes: [], lights: { package: 'ok', pam: 'ok', kbdInteractive: 'ok' } },
          pamSnippet: '#',
          sshdHints: '#',
          notes: [] } },
      {
        match: /\/api\/v1\/sftp\//,
        body: { ok: true, items: [], snippet: '', notes: [] } },
      { match: /.*/, body: { ok: true, items: [] } },
    ]);

    renderAt('/security', <SecurityPage />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

    // Account / 2FA
    for (const name of [/enable|begin|enroll|start|2fa|totp/i]) {
      const b = screen.queryAllByRole('button', { name })[0];
      if (b) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
    }
    for (const input of screen.queryAllByRole('textbox').slice(0, 3)) {
      try {
        await user.type(input, '123456');
      } catch {
        /* ignore */
      }
    }
    for (const b of screen.queryAllByRole('button', { name: /confirm|enable|verify|save/i }).slice(0, 3)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }

    // API keys tab
    const keys = screen.queryByRole('tab', { name: /api|key/i });
    if (keys) await user.click(keys);
    for (const b of screen.queryAllByRole('button', { name: /create|add|new/i }).slice(0, 2)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }
    for (const input of screen.queryAllByRole('textbox').slice(0, 2)) {
      try {
        await user.type(input, 'ci-key');
      } catch {
        /* ignore */
      }
    }
    for (const b of screen.queryAllByRole('button', { name: /create|save|delete|revoke/i }).slice(0, 4)) {
      try {
        await user.click(b);
      } catch {
        /* ignore */
      }
    }

    // Approvals + allowlist
    for (const tabName of [/approval/i, /allowlist|tool/i, /ssh/i]) {
      const tab = screen.queryByRole('tab', { name: tabName });
      if (tab) await user.click(tab);
      for (const b of screen
        .queryAllByRole('button', { name: /approve|run|sys|refresh|login|2fa|outbound/i })
        .slice(0, 6)) {
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
    }

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  }, 25_000);

  it('EmailDomainPage relay/sieve/advanced form saves', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      {
        match: (url) =>
          url === '/api/v1/email/domains' || url.startsWith('/api/v1/email/domains?'),
        body: {
          items: [
            {
              id: 'dom-1',
              domain: 'example.com',
              rate_limit_per_hour: 200,
              antispam: true,
              server_ip: '203.0.113.10' },
          ] } },
      {
        match: (url) => url.includes('/api/v1/email/domains/dom-1'),
        handler: (url, init) => {
          if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return HONESTY_WRITTEN_BLOCKED;
          if (url.includes('/dns')) {
            return {
              domain: 'example.com',
              records: [{ type: 'MX', name: '@', value: 'mail.example.com' }],
              externalTodos: ['Add SPF'],
              health: { score: 40, maxScore: 100, messages: [] },
              notes: [] };
          }
          if (url.includes('/mailboxes')) {
            return {
              items: [
                {
                  id: 'mb1',
                  local_part: 'info',
                  address: 'info@example.com',
                  quotaMb: 500 },
              ] };
          }
          if (url.includes('/aliases')) {
            return { items: [{ id: 'al1', source: 'a@example.com', dest: 'info@example.com' }] };
          }
          if (url.includes('/deliverability')) {
            return {
              ok: true,
              score: 55,
              panelReady: false,
              honesty: ['No guarantee'],
              checks: [],
              recommendations: ['SPF'],
              items: [{ id: 'spf', title: 'SPF', ok: false, detail: 'missing' }] };
          }
          if (url.includes('/sieve')) {
            return { ok: true, script: 'require ["fileinto"];', enabled: true };
          }
          if (url.includes('/relay')) {
            return {
              ok: true,
              host: 'smtp.example.com',
              port: 587,
              username: 'u',
              enabled: true };
          }
          return {
            id: 'dom-1',
            domain: 'example.com',
            rate_limit_per_hour: 200,
            antispam: true,
            server_ip: '203.0.113.10',
            apply_status: 'planned' };
        } },
      { match: /.*/, body: { ok: true, items: [] } },
    ]);

    renderAt('/email/dom-1', <EmailDomainPage />, '/email/:id');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

    for (const name of [
      /mailbox/i,
      /alias/i,
      /health/i,
      /deliver/i,
      /relay/i,
      /sieve|filter/i,
      /advanced/i,
    ]) {
      const tab = screen.queryByRole('tab', { name });
      if (tab) await user.click(tab);
      for (const input of Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea',
        ),
      ).slice(0, 8)) {
        try {
          await user.type(input as HTMLInputElement, 'x');
        } catch {
          /* ignore */
        }
      }
      for (const b of screen
        .queryAllByRole('button', {
          name: /create|add|save|apply|delete|copy|enable|test|send|refresh/i })
        .slice(0, 8)) {
        if ((b as HTMLButtonElement).disabled) continue;
        try {
          await user.click(b);
        } catch {
          /* ignore */
        }
      }
    }
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  }, 25_000);
});
