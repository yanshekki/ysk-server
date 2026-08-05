import { looksLikeBlockedMessage } from '../../shared/lib/operator-messages';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../shared/services/api';
import { sslApi, type CertificateView } from './api';

function notesFromThrown(e: unknown): string[] {
  if (e instanceof ApiError && e.details && typeof e.details === 'object') {
    const n = (e.details as { notes?: unknown }).notes;
    if (Array.isArray(n)) return n.map(String).filter(Boolean);
  }
  return [];
}

/** SSL apply step (from LE / system apply notes) */
export type SslCertStep = {
  name: string;
  status: 'ok' | 'skipped' | 'failed' | 'blocked';
  detail?: string;
};

export function useSslCertificates() {
  const { t } = useTranslation();
  const [items, setItems] = useState<CertificateView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [steps, setSteps] = useState<SslCertStep[]>([]);
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
        setMsg(t('ssl.savedCert', { domain }));
      } catch (e) {
        setOk(false);
        setError(e instanceof Error ? e.message : t('ssl.uploadFailed'));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh, clearResult, t],
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
        // L3: match backend Chinese / mixed permission notes until error codes exist
        const blockedFlag = Boolean(
          (r as { blocked?: boolean }).blocked ||
            (!r.ok &&
              looksLikeBlockedMessage(
                (r.notes ?? []).join(' '),
              )),
        );
        setBlocked(blockedFlag);
        setBlockMessage(
          (r as { blockMessage?: string }).blockMessage ||
            (blockedFlag
              ? (r.notes ?? [])[0] ?? t('ssl.requestBlocked')
              : null),
        );
        setOk(r.ok);
        const rNotes = r.notes ?? [];
        setNotes(rNotes);
        const rSteps = (r as { steps?: SslCertStep[] }).steps;
        setSteps(rSteps ?? []);
        if (r.ok) {
          setMsg(t('ssl.requestDone'));
          setError(null);
        } else if (blockedFlag) {
          setMsg(null);
        } else {
          // Lead with human reason (first note from backend LE classifier)
          setMsg(t('ssl.requestFailed'));
          setError(rNotes[0] || t('ssl.requestFailed'));
        }
        return r;
      } catch (e) {
        setOk(false);
        const fromBody = notesFromThrown(e);
        if (fromBody.length) {
          setNotes(fromBody);
          setError(fromBody[0] ?? t('ssl.applyFailed'));
          setMsg(t('ssl.requestFailed'));
        } else {
          setError(e instanceof Error ? e.message : t('ssl.applyFailed'));
        }
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh, clearResult, t],
  );

  const remove = useCallback(
    async (idOrDomain: string) => {
      setBusy(true);
      clearResult();
      try {
        const r = await sslApi.remove(idOrDomain);
        await refresh();
        setOk(true);
        setMsg(t('ssl.deletedCert', { domain: r.domain }));
        setNotes(r.notes ?? []);
      } catch (e) {
        setOk(false);
        setError(e instanceof Error ? e.message : t('common.deleteFailed'));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [refresh, clearResult, t],
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
    /** Last LE domain/email — enables Retry when set */
    lastLe,
    refresh,
    upload,
    requestCertificate,
    remove,
    retryLast,
    clearResult,
  };
}
