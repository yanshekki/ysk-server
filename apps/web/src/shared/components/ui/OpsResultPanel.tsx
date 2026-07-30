import type { OpsResultDto } from '@ysk/shared';
import { ActionBar } from './ActionBar';
import { useState } from 'react';
import { Badge } from './Badge';
import { buttonClassName } from './Button';
import { StructuredFacts, type FactItem } from './StructuredFacts';
import { humanizeOperatorMessage, sanitizeOperatorNotes } from '../../lib/operator-messages';

/**
 * Panel input — shared OpsResultDto plus optional UI-only process facts.
 * Canonical honesty fields live in @ysk/shared OpsResultDto.
 */
export type OpsResultLike = Partial<OpsResultDto> & {
  ok: boolean;
  notes?: string[];
  url?: string;
  processStatus?: string;
  requiresRoot?: boolean;
  requiresExecute?: boolean;
  blocked?: boolean;
  blockMessage?: string;
  port?: number;
  pid?: number;
  apply_status?: OpsResultDto['apply_status'];
};

export interface OpsResultPanelProps {
  title?: string;
  result: OpsResultLike | null;
  message?: string | null;
  facts?: FactItem[];
  onRetry?: () => void;
  busy?: boolean;
}

/**
 * Operator result panel — human notes only, never shell homework or raw JSON.
 */
export function OpsResultPanel({
  title = '操作結果',
  result,
  message,
  facts = [],
  onRetry,
  busy,
}: OpsResultPanelProps) {
  if (!result && !message && facts.length === 0) return null;

  // Never default missing ok to success when blocked / requires*
  const blocked = Boolean(result?.blocked || result?.requiresExecute || result?.requiresRoot);
  const ok =
    result == null
      ? true
      : typeof result.ok === 'boolean'
        ? result.ok
        : !blocked;
  const blockMessage = result?.blockMessage
    ? humanizeOperatorMessage(result.blockMessage)
    : undefined;
  const notes = sanitizeOperatorNotes([
    ...(result?.blockMessage ? [result.blockMessage] : []),
    ...(result?.notes ?? []),
  ]).filter((n) => n !== message && n !== blockMessage);

  const autoFacts: FactItem[] = [...facts];
  if (result?.processStatus) {
    autoFacts.push({ label: '狀態', value: result.processStatus });
  }
  if (result?.port != null) autoFacts.push({ label: '埠', value: String(result.port) });
  if (result?.url) {
    autoFacts.push({
      label: '網址',
      value: (
        <a href={result.url} target="_blank" rel="noreferrer">
          {result.url}
        </a>
      ),
    });
  }

  return (
    <div className="ops-result" role="status">
      <div className="ops-result__head">
        <h3 className="ops-result__title">{title}</h3>
        {blocked ? (
          <Badge tone="warn">無法執行</Badge>
        ) : (
          <Badge tone={ok ? 'ok' : 'danger'}>{ok ? '成功' : '失敗'}</Badge>
        )}
      </div>
      {message ? <p className="meta-block">{message}</p> : null}
      {blockMessage && blockMessage !== message ? (
        <p className="meta-block">{blockMessage}</p>
      ) : null}
      {autoFacts.length > 0 ? (
        <div className="u-mt-3">
          <StructuredFacts items={autoFacts} />
        </div>
      ) : null}
      {notes.length > 0 ? (
        <ul className="ops-result__notes">
          {notes.map((n, i) => (
            <li key={`${i}-${n.slice(0, 24)}`}>{n}</li>
          ))}
        </ul>
      ) : null}
      {blocked && onRetry ? (
        <ActionBar className="u-mt-3">
          <button
            type="button"
            className={buttonClassName({ variant: 'primary', size: 'sm' })}
            disabled={busy}
            onClick={onRetry}
          >
            再試
          </button>
        </ActionBar>
      ) : null}
    </div>
  );
}
