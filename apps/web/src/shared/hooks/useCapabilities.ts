/**
 * Effective capabilities for the signed-in user (from /auth/me).
 * Admin system role always treated as full-open (client fail-open).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  factoryRolePolicy,
  type CapabilityId,
} from '@ysk-server/shared';
import { authStore } from '../stores/auth-store';
import { api } from '../services/api';

function adminFallbackCaps(roles: string[] | undefined): CapabilityId[] | null {
  if (roles?.includes('admin')) {
    return factoryRolePolicy('admin').capabilities;
  }
  return null;
}

function resolveCaps(
  list: CapabilityId[],
  roles: string[] | undefined,
): CapabilityId[] {
  if (roles?.includes('admin')) {
    // Union server list with full factory — never leave admin empty/partial
    const full = factoryRolePolicy('admin').capabilities;
    return [...new Set([...full, ...list])].sort() as CapabilityId[];
  }
  if (list.length > 0) return list;
  return adminFallbackCaps(roles) ?? list;
}

export function useCapabilities() {
  const [caps, setCaps] = useState<CapabilityId[]>(() => {
    const u = authStore.getUser();
    return resolveCaps(authStore.getCapabilities() as CapabilityId[], u?.roles);
  });
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!authStore.getToken()) {
      setCaps([]);
      setLoaded(true);
      return;
    }
    try {
      const r = await api.me();
      const raw = (r.capabilities ?? r.user?.capabilities ?? []) as CapabilityId[];
      const roles = r.user?.roles ?? authStore.getUser()?.roles;
      const list = resolveCaps(raw, roles);
      authStore.setCapabilities(list);
      if (r.user) {
        const prev = authStore.getUser();
        authStore.setSession(authStore.getToken()!, {
          id: r.user.id ?? prev?.id,
          username: r.user.username,
          roles: r.user.roles,
          locale: r.user.locale ?? prev?.locale,
          capabilities: list,
        });
      }
      setCaps(list);
    } catch {
      // Fail-open for admin on network/me errors
      const u = authStore.getUser();
      const fallback = adminFallbackCaps(u?.roles);
      if (fallback) {
        authStore.setCapabilities(fallback);
        setCaps(fallback);
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return authStore.subscribe(() => {
      const u = authStore.getUser();
      setCaps(resolveCaps(authStore.getCapabilities() as CapabilityId[], u?.roles));
    });
  }, [refresh]);

  const can = useCallback(
    (cap: CapabilityId | CapabilityId[]) => {
      // Hard client fail-open: admin role may do anything
      if (authStore.getUser()?.roles?.includes('admin')) return true;
      const need = Array.isArray(cap) ? cap : [cap];
      return need.some((c) => caps.includes(c));
    },
    [caps],
  );

  return { capabilities: caps, can, loaded, refresh };
}
