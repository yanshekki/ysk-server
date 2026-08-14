import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './RequireAuth';
import { GuestOnly } from './GuestOnly';
import { RequireCapability } from './RequireCapability';
import { authStore } from '../../shared/stores/auth-store';

describe('RequireAuth', () => {
  afterEach(() => authStore.clear());

  it('redirects unauthenticated users to /login', () => {
    authStore.clear();
    render(
      <MemoryRouter initialEntries={['/secret']}>
        <Routes>
          <Route path="/login" element={<div>login-page</div>} />
          <Route
            path="/secret"
            element={
              <RequireAuth>
                <div>secret-content</div>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('login-page')).toBeInTheDocument();
    expect(screen.queryByText('secret-content')).not.toBeInTheDocument();
  });

  it('renders children when authenticated', () => {
    authStore.setSession('tok', { username: 'admin', roles: ['admin'] });
    render(
      <MemoryRouter initialEntries={['/secret']}>
        <Routes>
          <Route path="/login" element={<div>login-page</div>} />
          <Route
            path="/secret"
            element={
              <RequireAuth>
                <div>secret-content</div>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('secret-content')).toBeInTheDocument();
  });
});

describe('GuestOnly', () => {
  afterEach(() => authStore.clear());

  it('shows children for guests', () => {
    authStore.clear();
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/" element={<div>home-page</div>} />
          <Route
            path="/login"
            element={
              <GuestOnly>
                <div>guest-form</div>
              </GuestOnly>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('guest-form')).toBeInTheDocument();
  });

  it('redirects authenticated users home', () => {
    authStore.setSession('tok', { username: 'admin', roles: ['admin'] });
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/" element={<div>home-page</div>} />
          <Route
            path="/login"
            element={
              <GuestOnly>
                <div>guest-form</div>
              </GuestOnly>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('home-page')).toBeInTheDocument();
    expect(screen.queryByText('guest-form')).not.toBeInTheDocument();
  });
});

describe('RequireCapability', () => {
  beforeEach(() => {
    authStore.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            user: { username: 'u', roles: ['viewer'], locale: 'en' },
            capabilities: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
  });

  afterEach(() => {
    authStore.clear();
    vi.unstubAllGlobals();
  });

  it('allows admin role regardless of capabilities', async () => {
    authStore.setSession('tok', {
      username: 'admin',
      roles: ['admin'],
      capabilities: [] });
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/" element={<div>home-page</div>} />
          <Route
            path="/projects"
            element={
              <RequireCapability>
                <div>projects-ok</div>
              </RequireCapability>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('projects-ok')).toBeInTheDocument();
  });

  it('shows loading then a no-access page when path is not allowed', async () => {
    authStore.setSession('tok', {
      username: 'viewer',
      roles: ['viewer'],
      capabilities: [] });
    render(
      <MemoryRouter initialEntries={['/users']}>
        <Routes>
          <Route path="/" element={<div>home-page</div>} />
          <Route
            path="/users"
            element={
              <RequireCapability>
                <div>users-ok</div>
              </RequireCapability>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: /no access/i }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.queryByText('users-ok')).not.toBeInTheDocument();
    expect(screen.queryByText('home-page')).not.toBeInTheDocument();
  });
});
