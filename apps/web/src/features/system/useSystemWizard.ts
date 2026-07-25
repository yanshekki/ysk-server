/**
 * System wizard — run apply endpoints and surface result log.
 */
import { useCallback, useEffect, useState } from 'react';
import { systemApi } from './api';

export function useSystemWizard() {
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [certs, setCerts] = useState<Array<Record<string, unknown>>>([]);
  const [zoneFiles, setZoneFiles] = useState<Array<Record<string, unknown>>>([]);

  const refreshCerts = useCallback(async () => {
    try {
      const r = await systemApi.listSslCertificates();
      setCerts(r.items as Array<Record<string, unknown>>);
    } catch {
      /* optional until login */
    }
  }, []);

  const refreshZoneFiles = useCallback(async () => {
    try {
      const r = await systemApi.dnsZoneFiles();
      setZoneFiles(r.items);
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void refreshCerts();
    void refreshZoneFiles();
  }, [refreshCerts, refreshZoneFiles]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        setLog(JSON.stringify(r, null, 2));
        await refreshCerts();
        await refreshZoneFiles();
        return r;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refreshCerts, refreshZoneFiles],
  );

  return {
    log,
    error,
    setError,
    busy,
    certs,
    zoneFiles,
    run,
    refreshCerts,
    refreshZoneFiles,
    api: systemApi,
  };
}
