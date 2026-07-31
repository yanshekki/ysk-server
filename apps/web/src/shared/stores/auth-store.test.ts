import { afterEach, describe, expect, it } from 'vitest';
import { authStore } from './auth-store';

describe('authStore', () => {
  afterEach(() => {
    authStore.clear();
  });

  it('starts cleared after clear()', () => {
    authStore.clear();
    expect(authStore.getToken()).toBeNull();
    expect(authStore.getUser()).toBeNull();
    expect(authStore.isAuthenticated()).toBe(false);
    expect(authStore.getCapabilities()).toEqual([]);
  });

  it('setSession persists token + user + optional capabilities', () => {
    authStore.setSession('tok', {
      username: 'admin',
      roles: ['admin'],
      locale: 'en',
      capabilities: ['projects.read'],
    });
    expect(authStore.getToken()).toBe('tok');
    expect(authStore.isAuthenticated()).toBe(true);
    expect(authStore.getUser()?.username).toBe('admin');
    expect(authStore.getCapabilities()).toContain('projects.read');
  });

  it('setCapabilities updates store and user copy', () => {
    authStore.setSession('tok', { username: 'u', roles: ['viewer'] });
    authStore.setCapabilities(['files.read', 'logs.read']);
    expect(authStore.getCapabilities()).toEqual(['files.read', 'logs.read']);
    expect(authStore.getUser()?.capabilities).toEqual(['files.read', 'logs.read']);
  });

  it('setToken(null) clears session', () => {
    authStore.setSession('tok', { username: 'u', roles: [] });
    authStore.setToken(null);
    expect(authStore.getToken()).toBeNull();
    expect(authStore.getUser()).toBeNull();
  });

  it('subscribe notifies and unsubscribe stops', () => {
    let n = 0;
    const unsub = authStore.subscribe(() => {
      n += 1;
    });
    authStore.setToken('a');
    expect(n).toBeGreaterThanOrEqual(1);
    const before = n;
    unsub();
    authStore.setToken('b');
    expect(n).toBe(before);
  });
});
