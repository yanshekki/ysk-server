import { useCallback, useEffect, useState } from 'react';
import { sslApi, type CertificateView } from './api';
import type { ExecutionStep } from '../../shared/components/ui';

export function useSslCertificates() {
  const [items, setItems] = useState<CertificateView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [lastLe, setLastLe] = useState<{ domain: string; email: string } | null>(null);

  const clearResult = useCallback(() => {
    setMsg(null);
    setNotes([]);
    setSteps([]);
    setBlocked(false);
    setBlockMessage(null);
    setOk(undefined);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const r = await sslApi.list();
    setItems(r.items ?? []);
    return r.items;
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const upload = useCallback(
    async (domain: string, fullchainPem: string, privkeyPem: string) => {
      setBusy(true);
      clearResult();
      try {
        await sslApi.upload({ domain, fullchainPem, privkeyPem });
        await refresh();
        setOk(true);
        setMsg(`已儲存 ${domain} 的憑證`);
      } catch (e) {
        setOk(false);
        setError(e instanceof Error ? e.message : '上傳失敗');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh, clearResult],
  );

  const requestCertificate = useCallback(
    async (domain: string, email: string) => {
      setBusy(true);
      clearResult();
      setLastLe({ domain, email });
      try {
        // Always execute from panel — never ask user to run CLI
        let r: Awaited<ReturnType<typeof sslApi.letsencrypt>>;
        try {
          r = await sslApi.letsencrypt({ domain, email, execute: true });
        } catch {
          r = await sslApi.letsencryptViaSystem({ domain, email, run: true });
        }
        await refresh();
        const blockedFlag = Boolean(
          (r as { blocked?: boolean }).blocked ||
            (!r.ok && /權限|root|系統變更|無法在管理面板/i.test((r.notes ?? []).join(' '))),
        );
        setBlocked(blockedFlag);
        setBlockMessage(
          (r as { blockMessage?: string }).blockMessage ||
            (blockedFlag ? (r.notes ?? [])[0] ?? '無法在管理面板完成憑證申請' : null),
        );
        setOk(r.ok);
        setNotes(r.notes ?? []);
        const rSteps = (r as { steps?: ExecutionStep[] }).steps;
        setSteps(rSteps ?? []);
        setMsg(
          r.ok
            ? '憑證申請已完成'
            : blockedFlag
              ? null
              : '憑證申請未成功',
        );
        return r;
      } catch (e) {
        setOk(false);
        setError(e instanceof Error ? e.message : '申請失敗');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh, clearResult],
  );

  const remove = useCallback(
    async (idOrDomain: string) => {
      setBusy(true);
      clearResult();
      try {
        const r = await sslApi.remove(idOrDomain);
        await refresh();
        setOk(true);
        setMsg(`已刪除 ${r.domain}`);
        setNotes(r.notes ?? []);
      } catch (e) {
        setOk(false);
        setError(e instanceof Error ? e.message : '刪除失敗');
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh, clearResult],
  );

  const retryLast = useCallback(async () => {
    if (!lastLe) return;
    await requestCertificate(lastLe.domain, lastLe.email);
  }, [lastLe, requestCertificate]);

  return {
    items,
    error,
    msg,
    notes,
    steps,
    blocked,
    blockMessage,
    ok,
    busy,
    refresh,
    upload,
    requestCertificate,
    remove,
    retryLast,
    clearResult,
  };
}
