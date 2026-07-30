import { useEffect, useState, useCallback } from 'react';
import { authStore, type AuthUser } from '../stores/auth-store';
import { api } from '../services/api';
import { applyUserLocale } from '../lib/i18n';

export function useAuth() {
  const [token, setToken] = useState<string | null>(authStore.getToken());
  const [user, setUser] = useState<AuthUser | null>(authStore.getUser());

  useEffect(() => {
    return authStore.subscribe(() => {
      setToken(authStore.getToken());
      setUser(authStore.getUser());
    });
  }, []);

  const login = useCallback(async (username: string, password: string, totp?: string) => {
    const res = await api.login(username, password, totp);
    authStore.setSession(res.token, {
      id: res.user.id,
      username: res.user.username,
      roles: res.user.roles,
      locale: res.user.locale,
    });
    // Prefer account locale when server has one stored
    applyUserLocale(res.user.locale);
    // Load effective capabilities (not embedded in login response)
    try {
      const me = await api.me();
      const caps = me.capabilities ?? me.user?.capabilities ?? [];
      authStore.setCapabilities(caps);
      authStore.setSession(res.token, {
        id: me.user?.id ?? res.user.id,
        username: me.user?.username ?? res.user.username,
        roles: me.user?.roles ?? res.user.roles,
        locale: me.user?.locale ?? res.user.locale,
        capabilities: caps,
      });
    } catch {
      /* non-fatal */
    }
    return res;
  }, []);

  const logout = useCallback(async () => {
    try {
      if (authStore.getToken()) await api.logout();
    } catch {
      /* ignore network errors on logout */
    }
    authStore.clear();
  }, []);

  return {
    token,
    user,
    isAuthenticated: Boolean(token),
    login,
    logout,
  };
}
