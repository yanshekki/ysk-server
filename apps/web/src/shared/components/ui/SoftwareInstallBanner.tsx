/**
 * Compact one-click install strip — single CTA, no repeated buttons.
 */
import type { ReactNode } from 'react';
import { Alert } from './Alert';
import { useFeatureSoftware } from '../../../features/software';
import { OpsResultPanel, type OpsResultLike } from './OpsResultPanel';

export interface SoftwareInstallBannerProps {
  feature: string;
  onInstalled?: () => void;
  autoHideWhenReady?: boolean;
  title?: string;
  /** Compact: only show when missing; one install button */
  compact?: boolean;
}

export function SoftwareInstallBanner({
  feature,
  onInstalled,
  autoHideWhenReady = true,
  title,
}: SoftwareInstallBannerProps) {
  const {
    missing,
    ready,
    busy,
    error,
    msg,
    setMsg,
    setError,
    lastResult,
    refresh,
    installAll,
  } = useFeatureSoftware(feature);

  if (autoHideWhenReady && ready && !error && !msg && !lastResult) {
    return null;
  }

  // Ready and no residual messages
  if (ready && !error && !msg) {
    return null;
  }

  const names = missing.map((m) => m.title).join('、');
  const opsResult: OpsResultLike | null = lastResult
    ? {
        ok: Boolean(lastResult.ok),
        notes: lastResult.notes,
        blocked: lastResult.blocked,
        blockMessage: lastResult.blockMessage,
        requiresExecute: lastResult.blocked,
      }
    : error
      ? { ok: false, blocked: true, blockMessage: error, notes: [] }
      : null;

  return (
    <div className="software-install-banner u-mb-4">
      {!ready && missing.length > 0 ? (
        <CardLike>
          <div
            className="btn-row"
            style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}
          >
            <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
              <h3 className="ops-result__title" style={{ margin: 0 }}>
                {title ?? '尚未安裝所需軟件'}
              </h3>
              <p className="muted u-text-sm u-mt-2" style={{ marginBottom: 0 }}>
                缺少：{names}
              </p>
            </div>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() =>
                  void installAll().then((r) => {
                    if (r.ok) onInstalled?.();
                  })
                }
              >
                {busy ? '安裝中…' : '一鍵安裝'}
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setMsg(null);
                  void refresh();
                }}
              >
                重新探測
              </button>
            </div>
          </div>
        </CardLike>
      ) : null}

      {msg && !error ? (
        <Alert variant="ok">
          {msg}{' '}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMsg(null)}>
            關閉
          </button>
        </Alert>
      ) : null}

      {opsResult && (error || lastResult) ? (
        <div className="u-mt-3">
          <OpsResultPanel
            title="安裝結果"
            result={opsResult}
            onRetry={
              !ready
                ? () =>
                    void installAll().then((r) => {
                      if (r.ok) onInstalled?.();
                    })
                : undefined
            }
            busy={busy}
          />
        </div>
      ) : null}
    </div>
  );
}

function CardLike({ children }: { children: ReactNode }) {
  return (
    <div
      className="card"
      style={{
        borderColor: 'var(--color-warn, #f59e0b)',
        background: 'var(--color-warn-bg, rgba(245, 158, 11, 0.06))',
      }}
    >
      <div className="card__body" style={{ padding: '1rem 1.25rem' }}>
        {children}
      </div>
    </div>
  );
}
