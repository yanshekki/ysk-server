/**
 * Shared runner for system feature pages — panel execution results only.
 */
import { useCallback, useState } from 'react';
import type { OpsResultLike } from '../../shared/components/ui';
import {
  humanizeOperatorMessage,
  sanitizeOperatorNotes,
} from '../../shared/lib/operator-messages';

function toOpsResult(r: unknown): OpsResultLike {
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    const rawNotes: string[] = [];
    if (Array.isArray(o.notes)) rawNotes.push(...o.notes.map(String));
    if (Array.isArray(o.written)) {
      for (const _w of o.written) rawNotes.push('已寫入設定');
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
          ? notes[0] ?? '無法在管理面板完成此操作'
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
}

export function useFeatureAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpsResultLike | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>, okMessage?: string) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fn();
      const ops = toOpsResult(r);
      setResult(ops);
      if (ops.blocked) {
        setMsg(null);
      } else {
        setMsg(okMessage ?? (ops.ok ? '完成' : '操作未完全成功'));
      }
      return r;
    } catch (e) {
      const raw = e instanceof Error ? e.message : '操作失敗';
      const m = humanizeOperatorMessage(raw);
      const blocked = /權限|系統變更|管理員|無法在管理面板|沙箱/.test(m);
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
  }, []);

  return { busy, error, setError, result, msg, setMsg, run };
}
