import { useEffect, useState, useCallback } from 'react';
import { authStore, type AuthUser } from '../stores/auth-store';
import { api } from '../services/api';

export function useAuth() {
  const [token, setToken] = useState<string | null>(authStore.getToken());
  const [user, setUser] = useState<AuthUser | null>(authStore.getUser());

  useEffect(() => {
    return authStore.subscribe(() => {
      setToken(authStore.getToken());
      setUser(authStore.getUser());
    });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    authStore.setSession(res.token, {
      id: res.user.id,
      username: res.user.username,
      roles: res.user.roles,
      locale: res.user.locale,
    });
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
