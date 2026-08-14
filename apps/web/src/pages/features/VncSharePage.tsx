/**
 * Public VNC share viewer — no panel login.
 * Opened via /vnc-share/:token (view-only by default).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Alert, LoadingBlock } from '../../shared/components/ui';
import { vncApi } from '../../features/vnc/api';
import { VncViewer, type VncViewerTarget } from '../../features/vnc/VncViewer';

export function VncSharePage() {
  const { t } = useTranslation();
  const { token: rawToken } = useParams();
  const token = rawToken || '';
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<VncViewerTarget | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError(t('vnc.viewer.shareMissing'));
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const info = await vncApi.shareInfo(token);
        if (cancelled) return;
        if (!info.ok) {
          setError(info.message || t('vnc.viewer.shareExpired'));
          setLoading(false);
          return;
        }
        setTarget({
          kind: (info.kind === 'client' ? 'client' : 'account') as
            | 'account'
            | 'client',
          id: 'share',
          label: info.label || t('vnc.viewer.shareGuest'),
          subtitle: info.viewOnly
            ? t('vnc.viewer.viewOnlyBadge')
            : undefined,
          viewOnly: info.viewOnly !== false,
          shareToken: token,
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t('vnc.viewer.shareExpired'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t, token]);

  const createSession = useCallback(
    async (tgt: VncViewerTarget) => {
      const tok = tgt.shareToken || token;
      const r = await vncApi.shareSession(tok);
      if (!r.ok || !r.wsPath) {
        throw new Error(r.notes?.[0] || r.message || t('vnc.viewer.shareExpired'));
      }
      return {
        wsPath: r.wsPath,
        viewOnly: r.viewOnly !== false,
        notes: r.notes,
      };
    },
    [t, token],
  );

  return (
    <div className="vnc-share-page">
      <header className="vnc-share-page__head">
        <strong>{t('vnc.viewer.shareTitle')}</strong>
        {target ? (
          <span className="muted u-text-sm"> · {target.label}</span>
        ) : null}
      </header>
      {loading ? <LoadingBlock /> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {target && !error ? (
        <VncViewer
          target={target}
          createSession={createSession}
          onClose={() => {
            setTarget(null);
            setError(t('vnc.viewer.shareEnded', { defaultValue: t('vnc.viewer.shareExpired') }));
          }}
        />
      ) : null}
    </div>
  );
}
