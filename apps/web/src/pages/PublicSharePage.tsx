/**
 * Public file share landing — guest-first, direct + BitTorrent download.
 * YSK Limited branding (company name → ysk.hk), language switcher, download progress, BT stats.
 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  LOCALE_LABELS,
  LOCALES,
  normalizeLocale,
  type LocaleCode,
  type BtShareStats,
} from '@ysk/shared';
import { Alert, Button, Field, FormActions } from '../shared/components/ui';
import { setAppLocale } from '../shared/lib/i18n';

const COMPANY_URL = 'https://ysk.hk/';

type Phase = 'loading' | 'choose' | 'password' | 'downloading' | 'done' | 'error';

type ShareMeta = {
  needPassword: boolean;
  name?: string;
  downloadModes?: Array<'direct' | 'bt'>;
  hasBt?: boolean;
  hasDirect?: boolean;
  seedStatus?: string;
  expiresAt?: string;
  magnetUri?: string;
  torrentUrl?: string;
  infoHash?: string;
};

export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const m =
    /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(header);
  try {
    const raw = decodeURIComponent((m?.[1] || m?.[2] || m?.[3] || '').trim());
    return raw || fallback;
  } catch {
    return (m?.[1] || m?.[2] || m?.[3] || '').trim() || fallback;
  }
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatSpeed(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${Math.round(n)} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB/s`;
}

export function progressPercent(received: number, total: number | null): number | null {
  if (total == null || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((received / total) * 100)));
}

function triggerBlobDownload(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 2_000);
}

function fileKindIcon(name: string | null): string {
  if (!name) return '📄';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return '🎬';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return '🖼️';
  if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'].includes(ext)) return '🎵';
  if (ext === 'pdf') return '📕';
  if (['zip', 'tar', 'gz', '7z', 'rar', 'torrent'].includes(ext)) return '📦';
  return '📄';
}

export function PublicSharePage() {
  const { t, i18n } = useTranslation();
  const { token: rawToken } = useParams<{ token: string }>();
  const token = String(rawToken || '').trim();

  const [phase, setPhase] = useState<Phase>('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [btStats, setBtStats] = useState<BtShareStats | null>(null);
  const [magnet, setMagnet] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const autoStarted = useRef(false);

  const locale = normalizeLocale(i18n.language);
  const pct = progressPercent(received, total);

  const company = t('company');
  const product = t('product');

  const cancelDownload = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const passQ = useCallback(
    (pass?: string) => {
      const p = pass?.trim() || password.trim();
      return p ? `?password=${encodeURIComponent(p)}` : '';
    },
    [password],
  );

  const loadMeta = useCallback(async () => {
    if (!token) {
      setPhase('error');
      setError(t('files.publicShareMissing'));
      return;
    }
    try {
      const res = await fetch(`/api/v1/public/files/${encodeURIComponent(token)}/meta`);
      if (res.status === 404) {
        setPhase('error');
        setError(t('files.publicShareNotFound'));
        return;
      }
      if (!res.ok) {
        setPhase('error');
        setError(t('files.publicShareFailed', { status: res.status }));
        return;
      }
      const body = (await res.json()) as ShareMeta & { ok?: boolean };
      setMeta(body);
      if (body.name) setFileName(body.name);
      if (body.magnetUri) setMagnet(body.magnetUri);

      if (body.needPassword) {
        setPhase('password');
        return;
      }

      const hasBt = body.hasBt || (body.downloadModes ?? []).includes('bt');
      const hasDirect =
        body.hasDirect !== false &&
        (!(body.downloadModes?.length) || (body.downloadModes ?? []).includes('direct'));

      if (hasBt && hasDirect) {
        setPhase('choose');
        return;
      }
      if (hasBt && !hasDirect) {
        setPhase('choose');
        return;
      }
      // Direct only — auto start download
      setPhase('loading');
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : t('files.publicShareFailedGeneric'));
    }
  }, [t, token]);

  const refreshBtStats = useCallback(
    async (pass?: string) => {
      if (!token) return;
      try {
        const res = await fetch(
          `/api/v1/public/files/${encodeURIComponent(token)}/bt-stats${passQ(pass)}`,
        );
        if (!res.ok) return;
        const body = (await res.json()) as { stats?: BtShareStats };
        if (body.stats) setBtStats(body.stats);
      } catch {
        /* optional */
      }
    },
    [passQ, token],
  );

  const tryDownload = useCallback(
    async (pass?: string) => {
      if (!token) {
        setPhase('error');
        setError(t('files.publicShareMissing'));
        return;
      }

      cancelDownload();
      const ac = new AbortController();
      abortRef.current = ac;

      setError(null);
      setReceived(0);
      setTotal(null);
      setPhase((p) => (p === 'password' || p === 'done' || p === 'error' || p === 'choose' ? 'downloading' : 'loading'));

      try {
        const q = pass?.trim()
          ? `?password=${encodeURIComponent(pass.trim())}`
          : password.trim()
            ? `?password=${encodeURIComponent(password.trim())}`
            : '';
        const res = await fetch(`/api/v1/public/files/${encodeURIComponent(token)}${q}`, {
          signal: ac.signal,
        });

        if (res.status === 401) {
          let needPassword = true;
          try {
            const body = (await res.json()) as { needPassword?: boolean; message?: string };
            needPassword = body.needPassword !== false;
            if (pass?.trim() || password.trim()) {
              setError(body.message || t('files.publicShareBadPassword'));
            }
          } catch {
            /* */
          }
          setPhase(needPassword ? 'password' : 'error');
          if (!needPassword) setError(t('files.publicShareDenied'));
          return;
        }
        if (res.status === 404) {
          setPhase('error');
          setError(t('files.publicShareNotFound'));
          return;
        }
        if (res.status === 400) {
          try {
            const body = (await res.json()) as {
              message?: string;
              magnetUri?: string;
              torrentUrl?: string;
            };
            if (body.magnetUri) setMagnet(body.magnetUri);
            setPhase('choose');
            setError(body.message || null);
          } catch {
            setPhase('error');
            setError(t('files.publicShareFailed', { status: res.status }));
          }
          return;
        }
        if (!res.ok) {
          setPhase('error');
          setError(t('files.publicShareFailed', { status: res.status }));
          return;
        }

        setPhase('downloading');
        const name = filenameFromDisposition(
          res.headers.get('Content-Disposition'),
          t('files.publicShareDefaultName'),
        );
        setFileName(name);

        const lenHeader = res.headers.get('Content-Length');
        const contentLength =
          lenHeader && /^\d+$/.test(lenHeader) ? Number(lenHeader) : null;
        setTotal(contentLength);

        const chunks: BlobPart[] = [];
        let got = 0;

        if (res.body) {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              got += value.byteLength;
              setReceived(got);
            }
          }
        } else {
          const blob = await res.blob();
          chunks.push(blob);
          got = blob.size;
          setReceived(got);
          if (contentLength == null) setTotal(blob.size);
        }

        const mime = res.headers.get('Content-Type') || 'application/octet-stream';
        const out = new Blob(chunks, { type: mime });
        triggerBlobDownload(out, name);
        setPhase('done');
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setPhase('error');
          setError(t('files.publicShareCancelled'));
          return;
        }
        setPhase('error');
        setError(e instanceof Error ? e.message : t('files.publicShareFailedGeneric'));
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [cancelDownload, password, t, token],
  );

  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    void loadMeta().then(() => {
      /* after meta, auto-download only if direct-only without password */
    });
    return () => {
      cancelDownload();
    };
  }, [loadMeta, cancelDownload]);

  // Auto-start direct download when meta says direct-only + no password
  useEffect(() => {
    if (!meta || meta.needPassword) return;
    const hasBt = meta.hasBt || (meta.downloadModes ?? []).includes('bt');
    const hasDirect =
      meta.hasDirect !== false &&
      (!(meta.downloadModes?.length) || (meta.downloadModes ?? []).includes('direct'));
    if (hasDirect && !hasBt && phase === 'loading') {
      void tryDownload();
    }
  }, [meta, phase, tryDownload]);

  // Poll BT stats when BT available
  useEffect(() => {
    if (!meta) return;
    if (!meta.hasBt && !(meta.downloadModes ?? []).includes('bt')) return;
    if (meta.needPassword && phase === 'password') return;
    void refreshBtStats();
    const id = window.setInterval(() => void refreshBtStats(), 5_000);
    return () => window.clearInterval(id);
  }, [meta, phase, refreshBtStats]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const hasBt = meta?.hasBt || (meta?.downloadModes ?? []).includes('bt');
    const hasDirect =
      meta?.hasDirect !== false &&
      (!(meta?.downloadModes?.length) || (meta?.downloadModes ?? []).includes('direct'));
    if (hasBt && hasDirect) {
      setPhase('choose');
      return;
    }
    if (hasBt && !hasDirect) {
      setPhase('choose');
      void refreshBtStats(password);
      return;
    }
    void tryDownload(password);
  }

  function onLocaleChange(code: string) {
    setAppLocale(code, { syncServer: false });
  }

  const progressLabel = useMemo(() => {
    if (pct != null && total != null) {
      return t('files.publicShareProgress', {
        loaded: formatBytes(received),
        total: formatBytes(total),
        pct,
      });
    }
    if (received > 0) {
      return t('files.publicShareProgressIndeterminate', {
        loaded: formatBytes(received),
      });
    }
    return t('files.publicShareWait');
  }, [pct, received, t, total]);

  const sizeLabel =
    total != null || received > 0 ? formatBytes(total ?? received) : null;

  const torrentHref = token
    ? `/api/v1/public/files/${encodeURIComponent(token)}/torrent${passQ()}`
    : '#';

  const BtStatsBlock = btStats ? (
    <div className="pub-share__bt-stats u-mt-3">
      <p className="u-text-sm muted">{t('files.btServerStats')}</p>
      <ul className="u-text-sm u-stack u-gap-xs">
        <li>
          {t('files.btSeeds')}: <strong>{btStats.seeds}</strong> · {t('files.btLeechers')}:{' '}
          <strong>{btStats.leechers}</strong> · {t('files.btPeers')}:{' '}
          <strong>{btStats.peers}</strong>
        </li>
        <li>
          ↑ {formatSpeed(btStats.uploadSpeed)} · ↓ {formatSpeed(btStats.downloadSpeed)}
        </li>
        {btStats.seedStatus ? (
          <li>
            {t('files.shareBtStats')}: {btStats.seedStatus}
            {btStats.localSeeding ? ` (${t('files.btSeeding')})` : ''}
          </li>
        ) : null}
      </ul>
    </div>
  ) : null;

  return (
    <div className="pub-share">
      <div className="pub-share__shell">
        <header className="pub-share__top">
          <a
            className="pub-share__brand-link"
            href={COMPANY_URL}
            target="_blank"
            rel="noreferrer"
          >
            <img
              className="pub-share__logo"
              src="/logo.svg"
              alt=""
              width={44}
              height={44}
            />
            <span className="pub-share__brand-text">
              <span className="pub-share__product">{product}</span>
              <span className="pub-share__company">{company}</span>
            </span>
          </a>

          <label className="pub-share__lang">
            <span className="pub-share__lang-label">{t('files.publicShareLang')}</span>
            <select
              className="pub-share__lang-select"
              value={locale}
              onChange={(e) => onLocaleChange(e.target.value)}
              aria-label={t('files.publicShareLang')}
            >
              {LOCALES.map((code: LocaleCode) => (
                <option key={code} value={code}>
                  {LOCALE_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
        </header>

        <main className="pub-share__card">
          <div className="pub-share__head">
            <h1 className="pub-share__title">{t('files.publicShareTitle')}</h1>
            <p className="pub-share__sub">{t('files.publicShareSub')}</p>
          </div>

          {phase === 'loading' || phase === 'downloading' ? (
            <div className="pub-share__body">
              <div className="pub-share__file-panel">
                <div className="pub-share__file-icon" aria-hidden>
                  {fileKindIcon(fileName)}
                </div>
                <div className="pub-share__file-meta">
                  {fileName ? (
                    <p className="pub-share__file">
                      <strong>{fileName}</strong>
                    </p>
                  ) : (
                    <p className="pub-share__file muted">
                      {phase === 'downloading'
                        ? t('files.publicShareDownloading')
                        : t('files.publicShareChecking')}
                    </p>
                  )}
                  {sizeLabel ? (
                    <p className="pub-share__size">{sizeLabel}</p>
                  ) : null}
                </div>
              </div>

              <div
                className={
                  pct == null
                    ? 'pub-share__progress pub-share__progress--indeterminate'
                    : 'pub-share__progress'
                }
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? undefined}
                aria-label={t('files.publicShareDownloading')}
              >
                <div
                  className="pub-share__progress-fill"
                  style={pct != null ? { width: `${pct}%` } : undefined}
                />
              </div>
              <p className="pub-share__progress-label">{progressLabel}</p>
              {phase === 'downloading' ? (
                <FormActions className="pub-share__actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    onClick={() => {
                      cancelDownload();
                      setPhase('error');
                      setError(t('files.publicShareCancelled'));
                    }}
                  >
                    {t('files.publicShareCancel')}
                  </Button>
                </FormActions>
              ) : null}
            </div>
          ) : null}

          {phase === 'choose' ? (
            <div className="pub-share__body">
              <div className="pub-share__file-panel">
                <div className="pub-share__file-icon" aria-hidden>
                  {fileKindIcon(fileName || meta?.name || null)}
                </div>
                <div className="pub-share__file-meta">
                  {(fileName || meta?.name) ? (
                    <p className="pub-share__file">
                      <strong>{fileName || meta?.name}</strong>
                    </p>
                  ) : null}
                </div>
              </div>
              {error ? <Alert variant="error">{error}</Alert> : null}
              {BtStatsBlock}
              <FormActions className="pub-share__actions u-stack u-gap-sm">
                {(meta?.hasDirect !== false &&
                  (!(meta?.downloadModes?.length) ||
                    (meta?.downloadModes ?? []).includes('direct'))) ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    className="pub-share__cta"
                    onClick={() => void tryDownload(password || undefined)}
                  >
                    {t('files.shareModeDirect')}
                  </Button>
                ) : null}
                {(meta?.hasBt || (meta?.downloadModes ?? []).includes('bt')) ? (
                  <>
                    <a
                      className="btn btn--secondary btn--lg pub-share__cta"
                      href={torrentHref}
                    >
                      {t('files.shareTorrentFile')}
                    </a>
                    {(magnet || meta?.magnetUri) ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="lg"
                        onClick={() => {
                          const m = magnet || meta?.magnetUri || '';
                          void navigator.clipboard?.writeText(m).then(
                            () => undefined,
                            () => undefined,
                          );
                          window.location.href = m;
                        }}
                      >
                        {t('files.shareMagnet')}
                      </Button>
                    ) : null}
                    <p className="muted u-text-sm">{t('files.publicShareBt')}</p>
                  </>
                ) : null}
              </FormActions>
            </div>
          ) : null}

          {phase === 'password' ? (
            <form className="pub-share__body" onSubmit={onSubmit}>
              <Alert variant="info">{t('files.publicShareNeedPassword')}</Alert>
              {error ? <Alert variant="error">{error}</Alert> : null}
              <Field label={t('files.password')} htmlFor="pub-share-pass" flush required>
                <input
                  id="pub-share-pass"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('files.publicSharePasswordPh')}
                />
              </Field>
              <FormActions className="pub-share__actions">
                <Button type="submit" variant="primary" size="lg" className="pub-share__cta">
                  {t('files.publicShareDownload')}
                </Button>
              </FormActions>
            </form>
          ) : null}

          {phase === 'done' ? (
            <div className="pub-share__body">
              <div className="pub-share__ok" role="status">
                {t('files.publicShareDone')}
              </div>
              <div className="pub-share__file-panel">
                <div className="pub-share__file-icon" aria-hidden>
                  {fileKindIcon(fileName)}
                </div>
                <div className="pub-share__file-meta">
                  {fileName ? (
                    <p className="pub-share__file">
                      <strong>{fileName}</strong>
                    </p>
                  ) : null}
                  {sizeLabel ? (
                    <p className="pub-share__size">{sizeLabel}</p>
                  ) : null}
                </div>
              </div>
              <p className="muted pub-share__msg">{t('files.publicShareDoneHint')}</p>
              {BtStatsBlock}
              <FormActions className="pub-share__actions">
                <Button
                  variant="primary"
                  size="lg"
                  className="pub-share__cta"
                  onClick={() => void tryDownload(password || undefined)}
                >
                  {t('files.publicShareDownloadAgain')}
                </Button>
              </FormActions>
            </div>
          ) : null}

          {phase === 'error' ? (
            <div className="pub-share__body">
              <Alert variant="error">{error || t('files.publicShareFailedGeneric')}</Alert>
              <FormActions className="pub-share__actions">
                <Button
                  variant="primary"
                  size="lg"
                  className="pub-share__cta"
                  onClick={() => void tryDownload(password || undefined)}
                >
                  {t('common.retry')}
                </Button>
              </FormActions>
            </div>
          ) : null}
        </main>

        <footer className="pub-share__foot">
          <p className="pub-share__powered">
            {t('files.publicSharePoweredPrefix')}
            <a href={COMPANY_URL} target="_blank" rel="noreferrer">
              {company}
            </a>
            {t('files.publicSharePoweredSuffix')}
          </p>
        </footer>
      </div>
    </div>
  );
}
