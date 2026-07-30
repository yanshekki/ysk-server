/**
 * Sole page-level one-click install CTA (alert banner only).
 * Feature pages must not render additional 「一鍵安裝」 buttons.
 */
import { Alert } from './Alert';
import { buttonClassName } from './Button';
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
    <div className="software-install-banner">
      {!ready && missing.length > 0 ? (
        <div className="software-install-banner__alert" role="status">
          <div className="software-install-banner__row">
            <div className="software-install-banner__text">
              <h3 className="software-install-banner__title">
                {title ?? '尚未安裝所需軟件'}
              </h3>
              <p className="software-install-banner__desc">缺少：{names}</p>
            </div>
            <div className="software-install-banner__actions">
              <button
                type="button"
                className={buttonClassName({ variant: 'primary', size: 'md' })}
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
                className={buttonClassName({ variant: 'secondary', size: 'sm' })}
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
        </div>
      ) : null}

      {msg && !error ? (
        <Alert variant="ok">
          {msg}{' '}
          <button type="button" className={buttonClassName({ variant: 'ghost', size: 'sm' })} onClick={() => setMsg(null)}>
            關閉
          </button>
        </Alert>
      ) : null}

      {opsResult && (error || lastResult) ? (
        <div className="software-install-banner__result">
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
