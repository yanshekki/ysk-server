import { useMemo, useState } from 'react';
import type { OpsResultDto } from '@ysk/shared';
import { useTranslation } from 'react-i18next';
import { ActionBar } from './ActionBar';
import { Badge } from './Badge';
import { buttonClassName } from './Button';
import { StructuredFacts, type FactItem } from './StructuredFacts';
import {
  humanizeOperatorMessage,
  presentOpsNotes } from '../../lib/operator-messages';

/**
 * Panel input — shared OpsResultDto plus optional UI-only process facts.
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
  /** Start with technical details open (default false) */
  defaultShowTechnical?: boolean;
}

/**
 * Operator result — headline + facts + short summary; raw/tech notes collapsed.
 */
export function OpsResultPanel({
  title,
  result,
  message,
  facts = [],
  onRetry,
  busy,
  defaultShowTechnical = false }: OpsResultPanelProps) {
  const { t } = useTranslation();
  const [showTech, setShowTech] = useState(defaultShowTechnical);

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

  const presented = useMemo(
    () =>
      presentOpsNotes([
        ...(result?.blockMessage && !blockMessage ? [result.blockMessage] : []),
        ...(result?.notes ?? []),
      ]),
    [result?.blockMessage, result?.notes, blockMessage],
  );

  const summary = presented.summary.filter(
    (n) => n !== message && n !== blockMessage,
  );
  const technical = presented.technical.filter(
    (n) => n !== message && n !== blockMessage && !summary.includes(n),
  );

  if (!result && !message && facts.length === 0) return null;

  const autoFacts: FactItem[] = [...facts];
  if (result?.processStatus) {
    autoFacts.push({ label: t('opsResult.status'), value: result.processStatus });
  }
  if (result?.port != null) {
    autoFacts.push({ label: t('opsResult.port'), value: String(result.port) });
  }
  if (result?.pid != null) {
    autoFacts.push({ label: t('opsResult.pid'), value: String(result.pid) });
  }
  if (result?.url) {
    autoFacts.push({
      label: t('opsResult.url'),
      value: (
        <a href={result.url} target="_blank" rel="noreferrer">
          {result.url}
        </a>
      ) });
  }

  const hasBody =
    Boolean(message) ||
    Boolean(blockMessage) ||
    autoFacts.length > 0 ||
    summary.length > 0 ||
    technical.length > 0;

  if (!hasBody && !result) return null;

  return (
    <div className="ops-result" role="status">
      <div className="ops-result__head">
        <h3 className="ops-result__title">{title ?? t('opsResult.title')}</h3>
        {blocked ? (
          <Badge tone="warn">{t('opsResult.blocked')}</Badge>
        ) : (
          <Badge tone={ok ? 'ok' : 'danger'}>
            {ok ? t('opsResult.success') : t('opsResult.failed')}
          </Badge>
        )}
      </div>

      {message ? <p className="ops-result__headline">{message}</p> : null}
      {blockMessage && blockMessage !== message ? (
        <p className="ops-result__headline ops-result__headline--warn">{blockMessage}</p>
      ) : null}

      {autoFacts.length > 0 ? (
        <div className="ops-result__facts">
          <StructuredFacts items={autoFacts} />
        </div>
      ) : null}

      {summary.length > 0 ? (
        <ul className="ops-result__notes ops-result__notes--summary">
          {summary.map((n, i) => (
            <li key={`s-${i}-${n.slice(0, 20)}`}>{n}</li>
          ))}
        </ul>
      ) : null}

      {technical.length > 0 ? (
        <div className="ops-result__tech">
          <button
            type="button"
            className="ops-result__toggle-btn"
            aria-expanded={showTech}
            onClick={() => setShowTech((v) => !v)}
          >
            {showTech
              ? t('opsResult.hideDetails')
              : t('opsResult.showDetails', { count: technical.length })}
          </button>
          {showTech ? (
            <ul className="ops-result__notes ops-result__notes--tech">
              {technical.map((n, i) => (
                <li key={`t-${i}-${n.slice(0, 20)}`}>
                  <code className="ops-result__tech-line">{n}</code>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {blocked && onRetry ? (
        <ActionBar className="ops-result__actions">
          <button
            type="button"
            className={buttonClassName({ variant: 'primary', size: 'sm' })}
            disabled={busy}
            onClick={onRetry}
          >
            {t('opsResult.retry')}
          </button>
        </ActionBar>
      ) : null}
    </div>
  );
}
