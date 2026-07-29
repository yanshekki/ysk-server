import { useCallback, useEffect, useState } from 'react';
import { emailApi, type EmailDomain, type EmailBundle } from './api';

export function useEmailDomains() {
  const [items, setItems] = useState<EmailDomain[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await emailApi.list();
    setItems(r.items);
    return r.items;
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const create = useCallback(
    async (input: { domain: string; serverIp: string; serverIpv6?: string }) => {
      setBusy(true);
      setError(null);
      try {
        const created = await emailApi.create(input);
        await refresh();
        return created;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const loadDns = useCallback(async (id: string): Promise<EmailBundle> => {
    setBusy(true);
    setError(null);
    try {
      return await emailApi.dns(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  return { items, error, setError, busy, setBusy, refresh, create, loadDns };
}
