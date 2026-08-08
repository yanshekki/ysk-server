/**
 * Public file share landing — guest-first (no panel chrome).
 * YSK Limited branding, language switcher, streamed download with progress.
 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import {
  LOCALE_LABELS,
  LOCALES,
  normalizeLocale,
  type LocaleCode,
} from '@ysk/shared';
import { Alert, Button, Field, FormActions } from '../shared/components/ui';
import { setAppLocale } from '../shared/lib/i18n';

const COMPANY_URL = 'https://ysk.hk';

type Phase = 'loading' | 'password' | 'downloading' | 'done' | 'error';

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
  // Delay revoke so the browser can start the download
  window.setTimeout(() => URL.revokeObjectURL(href), 2_000);
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
      setPhase((p) => (p === 'password' || p === 'done' || p === 'error' ? 'downloading' : 'loading'));

      try {
        const q = pass?.trim()
          ? `?password=${encodeURIComponent(pass.trim())}`
          : '';
        const res = await fetch(`/api/v1/public/files/${encodeURIComponent(token)}${q}`, {
          signal: ac.signal,
        });

        if (res.status === 401) {
          let needPassword = true;
          try {
            const body = (await res.json()) as { needPassword?: boolean; message?: string };
            needPassword = body.needPassword !== false;
            if (pass?.trim()) {
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
    [cancelDownload, t, token],
  );

  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    void tryDownload();
    return () => {
      cancelDownload();
    };
  }, [tryDownload, cancelDownload]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
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
              width={36}
              height={36}
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
              {fileName ? (
                <p className="pub-share__file">
                  <strong>{fileName}</strong>
                </p>
              ) : null}
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
              <p className="muted pub-share__msg">
                {phase === 'downloading'
                  ? t('files.publicShareDownloading')
                  : t('files.publicShareChecking')}
              </p>
              {phase === 'downloading' ? (
                <FormActions>
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
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
              <FormActions>
                <Button type="submit" variant="primary" size="md">
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
              {fileName ? (
                <p className="pub-share__file">
                  <strong>{fileName}</strong>
                </p>
              ) : null}
              {total != null || received > 0 ? (
                <p className="muted pub-share__msg">
                  {formatBytes(total ?? received)}
                </p>
              ) : null}
              <p className="muted pub-share__msg">{t('files.publicShareDoneHint')}</p>
              <FormActions>
                <Button
                  variant="primary"
                  size="md"
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
              <FormActions>
                <Button
                  variant="primary"
                  size="md"
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
            {t('files.publicSharePoweredBy', { company })}{' '}
            <a href={COMPANY_URL} target="_blank" rel="noreferrer">
              ysk.hk
            </a>
          </p>
          <p className="pub-share__login-hint">
            <Link to="/login">{t('files.publicShareHasAccount')}</Link>
          </p>
        </footer>
      </div>
    </div>
  );
}
