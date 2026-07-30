/**
 * @deprecated Prefer OpsResultPanel with OpsResultDto / OpsResultLike.
 * Thin adapter for SSL-style step results — maps to OpsResultPanel.
 */
import { OpsResultPanel, type OpsResultLike } from './OpsResultPanel';

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

function stepLabel(s: ExecutionStep): string {
  const st =
    s.status === 'ok'
      ? '完成'
      : s.status === 'blocked'
        ? '無法執行'
        : s.status === 'failed'
          ? '失敗'
          : '略過';
  return s.detail ? `${s.name}: ${st} — ${s.detail}` : `${s.name}: ${st}`;
}

/**
 * Panel-only execution feedback. Never shows "copy this shell command".
 * Implementation: OpsResultPanel (single result primitive).
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
  busy,
}: ExecutionResultProps) {
  if (
    !message &&
    !blockMessage &&
    notes.length === 0 &&
    steps.length === 0 &&
    ok == null
  ) {
    return null;
  }

  const result: OpsResultLike = {
    ok: blocked ? false : ok !== false,
    blocked: Boolean(blocked),
    blockMessage: blockMessage ?? undefined,
    notes: [...steps.map(stepLabel), ...notes],
  };

  return (
    <OpsResultPanel
      title={title}
      result={result}
      message={message}
      onRetry={onRetry}
      busy={busy}
    />
  );
}
