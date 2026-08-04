/**
 * Shared runner for system feature pages — panel execution results only.
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpsResultLike } from '../../shared/components/ui';
import {
  humanizeOperatorMessage,
  looksLikeBlockedMessage,
  sanitizeOperatorNotes,
} from '../../shared/lib/operator-messages';

export function useFeatureAction() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpsResultLike | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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
          o.blocked || o.requiresExecute || o.requiresRoot || (o.ok === false && o.executed === false),
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
      setError(null);
      setMsg(null);
      try {
        const r = await fn();
        const ops = toOpsResult(r);
        setResult(ops);
        // Never show a success okMessage when the op failed (honesty).
        if (ops.blocked || ops.ok === false) {
          setMsg(null);
        } else {
          setMsg(okMessage ?? t('common.completed'));
        }
        return r;
      } catch (e) {
        const raw = e instanceof Error ? e.message : t('common.opFailed');
        const m = humanizeOperatorMessage(raw);
        // L4: multi-locale / code-aware block detection (not CJK-only)
        const blocked = looksLikeBlockedMessage(raw) || looksLikeBlockedMessage(m);
        setError(null);
        setResult({
          ok: false,
          blocked,
          blockMessage: m,
          notes: sanitizeOperatorNotes([raw]),
        });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [t, toOpsResult],
  );

  return { busy, error, setError, result, msg, setMsg, run };
}
