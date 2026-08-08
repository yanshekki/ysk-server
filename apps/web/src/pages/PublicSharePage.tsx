/**
 * Public file share landing — no panel login.
 * Password form when needed; then browser download via API blob.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Field,
  FormActions,
  buttonClassName,
} from '../shared/components/ui';

type Phase = 'loading' | 'password' | 'downloading' | 'done' | 'error';

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const m =
    /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(header);
  const raw = decodeURIComponent((m?.[1] || m?.[2] || m?.[3] || '').trim());
  return raw || fallback;
}

export function PublicSharePage() {
  const { t } = useTranslation();
  const { token: rawToken } = useParams<{ token: string }>();
  const token = String(rawToken || '').trim();

  const [phase, setPhase] = useState<Phase>('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const tryDownload = useCallback(
    async (pass?: string) => {
      if (!token) {
        setPhase('error');
        setError(t('files.publicShareMissing'));
        return;
      }
      setError(null);
      setPhase((p) => (p === 'password' ? 'downloading' : 'loading'));
      try {
        const q = pass?.trim()
          ? `?password=${encodeURIComponent(pass.trim())}`
          : '';
        const res = await fetch(`/api/v1/public/files/${encodeURIComponent(token)}${q}`);
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
        const blob = await res.blob();
        const name = filenameFromDisposition(
          res.headers.get('Content-Disposition'),
          t('files.publicShareDefaultName'),
        );
        setFileName(name);
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = name;
        a.click();
        URL.revokeObjectURL(href);
        setPhase('done');
      } catch (e) {
        setPhase('error');
        setError(e instanceof Error ? e.message : t('files.publicShareFailedGeneric'));
      }
    },
    [t, token],
  );

  useEffect(() => {
    void tryDownload();
  }, [tryDownload]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void tryDownload(password);
  }

  return (
    <div className="pub-share">
      <div className="pub-share__card">
        <header className="pub-share__head">
          <div className="pub-share__brand">{t('product', { defaultValue: 'YSK' })}</div>
          <h1 className="pub-share__title">{t('files.publicShareTitle')}</h1>
          <p className="pub-share__sub">{t('files.publicShareSub')}</p>
        </header>

        {phase === 'loading' || phase === 'downloading' ? (
          <div className="pub-share__body">
            <Badge tone="info">
              {phase === 'downloading'
                ? t('files.publicShareDownloading')
                : t('files.publicShareChecking')}
            </Badge>
            <p className="muted pub-share__msg">{t('files.publicShareWait')}</p>
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
            <Badge tone="ok">{t('files.publicShareDone')}</Badge>
            {fileName ? (
              <p className="pub-share__file">
                <strong>{fileName}</strong>
              </p>
            ) : null}
            <p className="muted pub-share__msg">{t('files.publicShareDoneHint')}</p>
            <FormActions>
              <Button
                variant="secondary"
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
              <Button variant="secondary" size="md" onClick={() => void tryDownload()}>
                {t('common.retry')}
              </Button>
            </FormActions>
          </div>
        ) : null}

        <footer className="pub-share__foot">
          <Link to="/login" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('files.publicSharePanelLogin')}
          </Link>
        </footer>
      </div>
    </div>
  );
}
