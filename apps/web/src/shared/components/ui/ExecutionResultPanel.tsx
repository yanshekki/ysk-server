import { Alert } from './Alert';
import { Badge } from './Badge';
import { sanitizeOperatorNotes } from '../../lib/operator-messages';

export type ExecutionStep = {
  name: string;
  status: 'ok' | 'skipped' | 'failed' | 'blocked';
  detail?: string;
};

export type ExecutionResultProps = {
  title?: string;
  ok?: boolean;
  executed?: boolean;
  blocked?: boolean;
  blockMessage?: string | null;
  message?: string | null;
  notes?: string[];
  steps?: ExecutionStep[];
  onRetry?: () => void;
  onDismiss?: () => void;
  busy?: boolean;
};

/**
 * Panel-only execution feedback. Never shows "copy this shell command".
 */
export function ExecutionResultPanel({
  title = '操作結果',
  ok,
  blocked,
  blockMessage,
  message,
  notes = [],
  steps = [],
  onRetry,
  onDismiss,
  busy,
}: ExecutionResultProps) {
  if (!message && !blockMessage && notes.length === 0 && steps.length === 0 && ok == null) {
    return null;
  }

  const variant = blocked ? 'info' : ok === false ? 'error' : 'ok';
  const headline =
    blockMessage ||
    message ||
    (ok === false ? '操作未成功' : ok ? '操作完成' : null);

  const cleanNotes = sanitizeOperatorNotes(notes).filter(
    (n) => n !== blockMessage && n !== message,
  );

  return (
    <div className="ops-result" role="status">
      <div className="ops-result__head">
        <h3 className="ops-result__title">{title}</h3>
        {blocked ? <Badge tone="warn">無法執行</Badge> : null}
        {!blocked && ok === true ? <Badge tone="ok">成功</Badge> : null}
        {!blocked && ok === false ? <Badge tone="danger">失敗</Badge> : null}
      </div>
      {headline ? <Alert variant={variant}>{headline}</Alert> : null}
      {steps.length > 0 ? (
        <ul className="ops-result__notes">
          {steps.map((s) => (
            <li key={s.name}>
              <strong>{s.name}</strong>:{' '}
              {s.status === 'ok'
                ? '完成'
                : s.status === 'blocked'
                  ? '無法執行'
                  : s.status === 'failed'
                    ? '失敗'
                    : '略過'}
              {s.detail ? ` — ${s.detail}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {cleanNotes.length > 0 ? (
        <ul className="ops-result__notes">
          {cleanNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div className="btn-row u-mt-3">
        {blocked && onRetry ? (
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={onRetry}>
            再試
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onDismiss}>
            關閉
          </button>
        ) : null}
      </div>
    </div>
  );
}
