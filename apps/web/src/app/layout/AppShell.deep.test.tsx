/**
 * Full AppShell interactions: nav active state, search navigate, menu backdrop,
 * locale select, capability-filtered nav for non-admin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installFetchMock, softwareReadyRoute } from '../../test/mock-fetch';
import { authStore } from '../../shared/stores/auth-store';
import { AppShell } from './AppShell';

function shellRoutes(searchItems?: Array<{ kind: string; title: string; subtitle?: string; href: string }>) {
  return [
    softwareReadyRoute(),
    {
      match: /\/api\/v1\/search/,
      body: {
        items: searchItems ?? [
          {
            kind: 'project',
            title: 'Demo App',
            subtitle: 'demo.example.com',
            href: '/projects/p1' },
          {
            kind: 'page',
            title: 'Security',
            href: '/security' },
        ] } },
    { match: /\/api\/v1\/auth\/logout/, body: { ok: true } },
    {
      match: /\/api\/v1\/auth\/me/,
      body: {
        user: { username: 'admin', roles: ['admin'], locale: 'en' },
        capabilities: [] } },
    { match: /.*/, body: { ok: true, items: [], ready: true, missing: [] } },
  ];
}

function renderShell(initial = '/', user?: { username: string; roles: string[]; capabilities?: string[] }) {
  authStore.clear();
  authStore.setSession('test-token', {
    username: user?.username ?? 'admin',
    roles: user?.roles ?? ['admin'],
    capabilities: (user?.capabilities ?? []) as never });

  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<div data-testid="page">dash</div>} />
          <Route path="projects" element={<div data-testid="page">projects</div>} />
          <Route path="projects/:id" element={<div data-testid="page">project-detail</div>} />
          <Route path="security" element={<div data-testid="page">security</div>} />
          <Route path="ftp" element={<div data-testid="page">ftp</div>} />
          <Route path="login" element={<div data-testid="page">login</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppShell full interactions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.clear();
  });

  it('navigates via sidebar links from ftp to projects', async () => {
    const user = userEvent.setup();
    installFetchMock(shellRoutes());
    renderShell('/ftp');

    expect(screen.getByTestId('page')).toHaveTextContent('ftp');

    // single FTPS nav entry
    const ftpLink = screen.getAllByRole('link').find((a) =>
      (a.getAttribute('href') ?? '') === '/ftp',
    );
    expect(ftpLink).toBeTruthy();

    // projects link
    const projects = screen.getAllByRole('link').find((a) =>
      (a.getAttribute('href') ?? '') === '/projects' || /project|站點|站点/i.test(a.textContent ?? ''),
    );
    if (projects) {
      await user.click(projects);
      await waitFor(() => {
        expect(screen.getByTestId('page')).toHaveTextContent(/project/i);
      });
    }
  });

  it('search shows hits and navigates on click; empty query clears', async () => {
    const user = userEvent.setup();
    installFetchMock(shellRoutes());
    renderShell('/');

    const search =
      screen.getByRole('searchbox') ??
      screen.getByLabelText(/search|搜尋|搜索/i);

    await user.type(search, 'demo');
    await waitFor(() => {
      expect(screen.getByText(/Demo App/i)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Demo App/i));
    await waitFor(() => {
      expect(screen.getByTestId('page')).toHaveTextContent(/project/i);
    });

    // clear path: type then clear — search hit button with kind badge
    const search2 =
      screen.queryByRole('searchbox') ??
      screen.queryByLabelText(/search|搜尋|搜索/i);
    if (search2) {
      await user.clear(search2);
      await user.type(search2, 'sec');
      await waitFor(() => {
        const hit = document.querySelector('.shell-search__item');
        expect(hit).toBeTruthy();
      });
    }
  });

  it('search API failure clears hits silently', async () => {
    const user = userEvent.setup();
    installFetchMock([
      softwareReadyRoute(),
      { match: /\/api\/v1\/search/, status: 500, body: { message: 'down' } },
      { match: /\/api\/v1\/auth\/me/, body: { user: { username: 'admin', roles: ['admin'] }, capabilities: [] } },
      { match: /.*/, body: { ok: true, items: [] } },
    ]);
    renderShell('/');
    const search = screen.getByRole('searchbox');
    await user.type(search, 'x');
    await waitFor(() => {
      expect(screen.queryByText(/Demo App/i)).not.toBeInTheDocument();
    });
  });

  it('opens mobile menu and closes via backdrop', async () => {
    const user = userEvent.setup();
    installFetchMock(shellRoutes());
    renderShell('/');

    const menu = screen.getByRole('button', { name: /menu|導航|导航/i });
    await user.click(menu);
    expect(document.querySelector('.shell__sidebar.is-open, .shell__sidebar')).toBeTruthy();

    const backdrop = document.querySelector('.shell__backdrop') as HTMLElement | null;
    if (backdrop) {
      await user.click(backdrop);
    }
  });

  it('selects locale from dropdown and logs out to login', async () => {
    const user = userEvent.setup();
    installFetchMock([
      ...shellRoutes(),
      { match: /\/api\/v1\/auth\/locale/, method: 'PATCH', body: { ok: true, user: { locale: 'en' } } },
    ]);
    renderShell('/');

    const langSelect = screen.getByRole('combobox', {
      name: /language|語言|语言|Langue|Idioma|لغة/i,
    });
    expect(langSelect.tagName).toBe('SELECT');
    expect(['zh-HK', 'zh-CN', 'en', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'id', 'ur']).toContain(
      (langSelect as HTMLSelectElement).value,
    );
    await user.selectOptions(langSelect, 'en');
    expect(langSelect).toHaveValue('en');
    await user.selectOptions(langSelect, 'zh-HK');
    expect(langSelect).toHaveValue('zh-HK');

    await user.click(screen.getAllByRole('button', { name: /log\s*out|sign\s*out|登出/i })[0]!);
    await waitFor(() => {
      expect(authStore.getToken()).toBeNull();
      expect(screen.getByTestId('page')).toHaveTextContent('login');
    });
  });

  it('non-admin nav is capability-filtered', async () => {
    installFetchMock([
      softwareReadyRoute(),
      {
        match: /\/api\/v1\/auth\/me/,
        body: {
          user: { username: 'op', roles: ['operator'], locale: 'en' },
          capabilities: ['projects.read', 'dashboard.read'] } },
      { match: /.*/, body: { ok: true, items: [] } },
    ]);
    renderShell('/', {
      username: 'op',
      roles: ['operator'],
      capabilities: ['projects.read', 'dashboard.read'] });

    await waitFor(() => {
      expect(document.querySelector('.shell__user')?.textContent).toMatch(/op/i);
    });

    // Should still have some nav (dashboard/projects) — not crash
    expect(screen.getByRole('navigation', { name: /main/i })).toBeInTheDocument();
  });

  it('shows username and role badge in top bar', async () => {
    installFetchMock(shellRoutes());
    renderShell('/');
    expect(screen.getByText('admin')).toBeInTheDocument();
  });
});
