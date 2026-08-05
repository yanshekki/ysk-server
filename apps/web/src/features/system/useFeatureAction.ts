/**
 * Shared runner for system feature pages — panel execution results only.
 * Operation feedback uses top-right toast (not in-page Alert).
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpsResultLike } from '../../shared/components/ui';
import { ApiError } from '../../shared/services/api';
import {
  humanizeOperatorMessage,
  looksLikeBlockedMessage,
  sanitizeOperatorNotes,
} from '../../shared/lib/operator-messages';
import { notifyError, notifyOk, notifyWarn } from '../../shared/lib/notify';

export function useFeatureAction() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OpsResultLike | null>(null);
  /** Page banners unused — feedback is toast-only (API kept for callers). */
  const [error, setErrorRaw] = useState<string | null>(null);
  const [msg, setMsgRaw] = useState<string | null>(null);
  const setMsg = useCallback((m: string | null) => {
    if (m) notifyOk(m);
    setMsgRaw(null);
  }, []);
  const setError = useCallback((m: string | null) => {
    if (m) notifyError(m);
    setErrorRaw(null);
  }, []);

  const toOpsResult = useCallback(
    (r: unknown): OpsResultLike => {
      if (r && typeof r === 'object') {
        const o = r as Record<string, unknown>;
        const rawNotes: string[] = [];
        if (Array.isArray(o.notes)) rawNotes.push(...o.notes.map(String));
        if (Array.isArray(o.written)) {
          for (const _w of o.written) rawNotes.push(t('common.writtenSettings'));
        }
        if (Array.isArray(o.messages)) rawNotes.push(...o.messages.map(String));
        if (typeof o.message === 'string') rawNotes.push(o.message);
        if (typeof o.summary === 'string') rawNotes.push(o.summary);
        if (typeof o.blockMessage === 'string') rawNotes.push(o.blockMessage);

        const notes = sanitizeOperatorNotes(rawNotes);
        const blocked = Boolean(
          o.blocked ||
            o.requiresExecute ||
            o.requiresRoot ||
            o.apply_status === 'blocked' ||
            (o.ok === false && o.executed === false),
        );
        const blockMessage =
          typeof o.blockMessage === 'string'
            ? humanizeOperatorMessage(o.blockMessage)
            : blocked
              ? notes[0] ?? t('common.panelBlocked')
              : undefined;

        return {
          ok: o.ok !== false && o.error == null && !blocked,
          notes,
          url: typeof o.url === 'string' ? o.url : undefined,
          processStatus: typeof o.processStatus === 'string' ? o.processStatus : undefined,
          requiresRoot: Boolean(o.requiresRoot),
          requiresExecute: Boolean(o.requiresExecute),
          blocked,
          blockMessage,
          port: typeof o.port === 'number' ? o.port : undefined,
          pid: typeof o.pid === 'number' ? o.pid : undefined,
        };
      }
      return { ok: true, notes: sanitizeOperatorNotes([String(r)]) };
    },
    [t],
  );

  const run = useCallback(
    async (fn: () => Promise<unknown>, okMessage?: string) => {
      setBusy(true);
      setErrorRaw(null);
      setMsgRaw(null);
      try {
        const r = await fn();
        const ops = toOpsResult(r);
        setResult(ops);
        // Never toast success when the op failed (honesty).
        if (ops.blocked || ops.ok === false) {
          const warn =
            ops.blockMessage ?? ops.notes?.[0] ?? t('common.panelBlocked');
          notifyWarn(warn);
        } else {
          // Prefer caller label; fall back to first operator note, then generic completed
          const note = ops.notes?.[0]?.trim();
          notifyOk(okMessage ?? note ?? t('common.completed'));
        }
        return r;
      } catch (e) {
        // Prefer full ops body from 403/422 responses (notes + requires* flags)
        if (e instanceof ApiError && e.details && typeof e.details === 'object') {
          const d = e.details as Record<string, unknown>;
          if (
            Array.isArray(d.notes) ||
            d.requiresExecute != null ||
            d.requiresRoot != null ||
            d.blocked != null ||
            typeof d.blockMessage === 'string'
          ) {
            const ops = toOpsResult({ ...d, ok: false });
            setResult(ops);
            notifyWarn(ops.blockMessage ?? ops.notes?.[0] ?? t('common.opFailed'));
            return null;
          }
        }
        const raw = e instanceof Error ? e.message : t('common.opFailed');
        const m = humanizeOperatorMessage(raw);
        // L4: multi-locale / code-aware block detection (not CJK-only)
        const blocked = looksLikeBlockedMessage(raw) || looksLikeBlockedMessage(m);
        setResult({
          ok: false,
          blocked,
          blockMessage: m,
          notes: sanitizeOperatorNotes([raw]),
        });
        notifyError(m);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [t, toOpsResult],
  );

  return { busy, error, setError, result, msg, setMsg, run };
}
