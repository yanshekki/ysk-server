/**
 * Projects feature — list/create/refresh hook.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ProjectDto } from '@ysk/shared';
import { projectsApi } from './api';

export function useProjects() {
  const [items, setItems] = useState<ProjectDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await projectsApi.list();
    setItems(r.items);
    return r.items;
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const create = useCallback(
    async (input: {
      name: string;
      domain?: string;
      domainAliases?: string[];
      runtime?: string;
      templateId?: string;
      createDnsZone?: boolean;
      createMailDomain?: boolean;
      serverIp?: string;
      serverIpv6?: string;
    }) => {
      setBusy(true);
      setError(null);
      try {
        const r = await projectsApi.create(input);
        await refresh();
        return r;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'create failed';
        setError(msg);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        await projectsApi.remove(id);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'delete failed');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return { items, error, setError, busy, setBusy, refresh, create, remove };
}
