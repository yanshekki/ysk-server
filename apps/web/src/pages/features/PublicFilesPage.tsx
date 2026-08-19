/**
 * Public files nginx site — settings + live status (honest 404 diagnostics).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNginxServerNameToken } from 'ysk-server-shared';
import {
  WithPageGuide,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  DescriptionList,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  OpsResultPanel,
  PresetChips,
  buttonClassName,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { getServerContext, setServerContext } from '../../shared/stores/server-context';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { Link } from 'react-router-dom';

type FilesStatus = Awaited<ReturnType<typeof systemApi.publicFilesStatus>>;

function suggestedFilesHost(): string {
  const ctx = getServerContext();
  if (ctx.domain?.trim()) return `files.${ctx.domain.trim()}`;
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  if (!host || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return '';
  return host.startsWith('files.') ? host : `files.${host}`;
}

function parseQuotaMb(raw: string): { ok: boolean; value?: number; unlimited: boolean } {
  const s = raw.trim();
  if (!s) return { ok: true, unlimited: true };
  if (!/^\d+$/.test(s)) return { ok: false, unlimited: false };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 1_048_576) return { ok: false, unlimited: false };
  return { ok: true, value: n, unlimited: false };
}

export function PublicFilesPage() {
  const { t } = useTranslation();
  const suggested = suggestedFilesHost();
  const [serverName, setServerName] = useState(suggested);
  const [quotaMb, setQuotaMb] = useState('1024');
  const [autoindex, setAutoindex] = useState(true);
  const { busy, error, result, msg, run } = useFeatureAction();
  const [status, setStatus] = useState<FilesStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const hydrated = useRef(false);

  const refreshStatus = useCallback(async () => {
    setStatusErr(null);
    try {
      const s = await systemApi.publicFilesStatus();
      setStatus(s);
      if (!hydrated.current) {
        hydrated.current = true;
        if (s.serverName?.trim()) setServerName(s.serverName.trim());
        if (typeof s.quotaMb === 'number' && s.quotaMb > 0) setQuotaMb(String(s.quotaMb));
        else if (s.serverName) setQuotaMb('');
      }
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const liveTone = status?.likelyLive ? 'ok' : status?.managedConfExists ? 'warn' : 'danger';
  const liveName = (status?.liveServerName || '').trim();
  const persistedDraft = (status?.serverName || '').trim();
  const formName = serverName.trim();
  const persistedDraftDiffers = Boolean(liveName && persistedDraft && liveName !== persistedDraft);
  const formDiffersFromLive = Boolean(liveName && formName && liveName !== formName);
  const draftDiffers = persistedDraftDiffers || formDiffersFromLive;
  const nameInvalid = nameTouched && !formName;
  const nameFormatBad = Boolean(formName) && !isNginxServerNameToken(formName);
  const quota = parseQuotaMb(quotaMb);
  const openHost = liveName || (status?.likelyLive ? formName : '');
  const openHref = openHost
    ? `${status?.hasTls ? 'https' : 'http'}://${openHost}/`
    : '';

  return (
    <FeaturePageLayout
      title={t('nav.publicFiles')}
      showCapability={false}
      status={{
        pill: {
          label: draftDiffers
            ? t('publicFiles.statusDraft')
            : status?.likelyLive
              ? t('publicFiles.statusLive')
              : status?.managedConfExists
                ? t('publicFiles.statusManagedOnly')
                : t('publicFiles.statusNotApplied'),
          tone: draftDiffers ? 'warn' : liveTone,
        },
        items: [
          {
            label: t('publicFiles.liveName'),
            value: liveName || t('common.noneSelectedShort'),
          },
          {
            label: t('publicFiles.draftName'),
            value: serverName.trim() || t('common.noneSelectedShort'),
            tone: draftDiffers ? 'warn' : undefined,
            hint: draftDiffers
              ? t('publicFiles.serverNameMismatch', {
                  live: liveName,
                  draft: serverName.trim(),
                })
              : undefined,
          },
          {
            label: t('publicFiles.quota'),
            value: quota.unlimited
              ? t('publicFiles.unlimited')
              : quota.ok
                ? `${quota.value} MiB`
                : t('publicFiles.quotaInvalid'),
          },
          {
            label: t('publicFiles.path'),
            value: status?.publicRoot ?? 'dataDir/files/public',
          },
          {
            label: 'Nginx',
            value: status?.systemConfExists
              ? t('publicFiles.nginxLive')
              : t('publicFiles.nginxNotLive'),
            tone: status?.systemConfExists ? 'ok' : 'warn',
          },
        ],
      }}
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={() => void refreshStatus()}>
            {t('common.refresh')}
          </Button>
          <Link to="/files" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('publicFiles.fileManager')}
          </Link>
          <Link to="/nginx" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
            Nginx
          </Link>
          {openHref ? (
            <a
              href={openHref}
              target="_blank"
              rel="noreferrer"
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
              title={
                status?.likelyLive
                  ? openHref
                  : t('publicFiles.notLiveHint')
              }
            >
              {t('publicFiles.openSite')}
            </a>
          ) : null}
        </>
      }
    >
      <WithPageGuide guideId="publicFiles">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {statusErr ? <Alert variant="error">{statusErr}</Alert> : null}

        {!status?.likelyLive ? (
          <Alert variant="warn">
            {t('publicFiles.notLiveHint')}
          </Alert>
        ) : null}

        <Card>
          <CardSection
            title={t('publicFiles.overview')}
            description={t('publicFiles.overviewDesc')}
          >
            <DescriptionList
              columns={2}
              items={[
                {
                  label: t('publicFiles.liveName'),
                  value: liveName || t('common.noneSelectedShort'),
                },
                {
                  label: t('publicFiles.draftName'),
                  value: serverName || t('common.noneSelectedShort'),
                },
                {
                  label: t('publicFiles.quota'),
                  value: quota.unlimited
              ? t('publicFiles.unlimited')
              : quota.ok
                ? `${quota.value} MiB`
                : t('publicFiles.quotaInvalid'),
                },
                {
                  label: t('publicFiles.diskRoot'),
                  value: (
                    <code className="inline u-break-all">
                      {status?.publicRoot ?? '…/files/public'}
                    </code>
                  ),
                },
                {
                  label: t('publicFiles.filesInRoot'),
                  value: status ? String(status.fileCount) : '—',
                },
                {
                  label: t('publicFiles.managedConf'),
                  value: status?.managedConfExists ? (
                    <Badge tone="ok">{t('common.yes')}</Badge>
                  ) : (
                    <Badge tone="warn">{t('common.no')}</Badge>
                  ),
                },
                {
                  label: t('publicFiles.systemConf'),
                  value: status?.systemConfExists ? (
                    <Badge tone="ok">{t('common.yes')}</Badge>
                  ) : (
                    <Badge tone="danger">{t('common.no')}</Badge>
                  ),
                },
                {
                  label: t('publicFiles.executeFlag'),
                  value: status?.executeEnabled ? t('common.on') : t('common.off'),
                },
                {
                  label: t('publicFiles.asRoot'),
                  value: status?.isRoot ? t('common.yes') : t('common.no'),
                },
              ]}
            />
            {status?.notes?.length ? (
              <ul className="u-mt-3 u-pl-5 muted u-text-sm">
                {status.notes.slice(0, 8).map((n) => (
                  <li key={n}>
                    {n.startsWith('Live system conf:')
                      ? t('publicFiles.liveSystemConf', { path: n.replace(/^Live system conf:\s*/, '') })
                      : n.startsWith('Public root:')
                        ? t('publicFiles.publicRootNote', { path: n.replace(/^Public root:\s*/, '') })
                        : /^No managed Nginx conf/i.test(n)
                          ? t('publicFiles.notes.noManagedConf')
                          : /not under \/etc\/nginx\/conf\.d/i.test(n)
                            ? t('publicFiles.notes.notSynced')
                            : n}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardSection>
        </Card>

        <Card>
          <CardSection
            title={t('publicFiles.siteSettings')}
            description={t('publicFiles.siteSettingsDesc')}
          >
            <FormLayout columns={2}>
              <Field
                label={t('publicFiles.serverName')}
                htmlFor="pf-sn"
                flush
                required
                hint={t('publicFiles.serverNameHint')}
                error={
                  nameInvalid
                    ? t('publicFiles.serverNameRequired')
                    : nameFormatBad
                      ? t('publicFiles.serverNameInvalid')
                      : undefined
                }
              >
                <input
                  id="pf-sn"
                  value={serverName}
                  onChange={(e) => {
                    setNameTouched(true);
                    setServerName(e.target.value);
                    const v = e.target.value.trim();
                    if (v) setServerContext({ domain: v.replace(/^files\./, '') });
                  }}
                  placeholder={suggested || 'files.example.com'}
                  spellCheck={false}
                />
              </Field>
              <Field
                label={t('publicFiles.quotaMiB')}
                htmlFor="pf-q"
                flush
                hint={t('publicFiles.quotaHint')}
                error={quota.ok ? undefined : t('publicFiles.quotaInvalid')}
              >
                <PresetChips
                  options={[
                    { value: '', label: t('publicFiles.unlimited') },
                    { value: '512', label: '512' },
                    { value: '1024', label: '1G' },
                    { value: '5120', label: '5G' },
                    { value: '10240', label: '10G' },
                    { value: '51200', label: '50G' },
                  ]}
                  value={quota.unlimited ? '' : quotaMb}
                  onChange={setQuotaMb}
                />
                <input
                  id="pf-q"
                  type="number"
                  min={1}
                  max={1048576}
                  step={1}
                  className="input u-mt-2"
                  disabled={quota.unlimited}
                  value={quota.unlimited ? '' : quotaMb}
                  onChange={(e) => setQuotaMb(e.target.value)}
                  placeholder="MiB"
                />
              </Field>
            </FormLayout>
            <label className="ssh-check u-mt-3">
              <input
                type="checkbox"
                checked={autoindex}
                onChange={(e) => setAutoindex(e.target.checked)}
              />
              <span>{t('publicFiles.autoindex', { defaultValue: 'Directory listing (autoindex)' })}</span>
            </label>
            {draftDiffers ? (
              <Alert variant="warn">
                {t('publicFiles.serverNameMismatch', {
                  live: liveName || t('common.noneSelectedShort'),
                  draft: formName || persistedDraft || t('common.noneSelectedShort'),
                })}{' '}
                {t('publicFiles.draftUnapplied')}
              </Alert>
            ) : null}
            <FormHint>{t('publicFiles.applyHint')}</FormHint>
            <FormActions>
              <Button
                variant="primary"
                size="md"
                loading={busy}
                disabled={!formName || nameFormatBad || !quota.ok}
                title={
                  !formName
                    ? t('publicFiles.serverNameRequired')
                    : t('publicFiles.applyConfirmTitle')
                }
                onClick={() => {
                  setNameTouched(true);
                  if (!formName || nameFormatBad || !quota.ok) return;
                  setApplyOpen(true);
                }}
              >
                {t('publicFiles.applyReload')}
              </Button>
              {draftDiffers ? (
                <Button
                  variant="secondary"
                  size="md"
                  disabled={busy || !liveName}
                  title={t('publicFiles.discardDraft')}
                  onClick={() => {
                    setServerName(liveName);
                    setNameTouched(false);
                    if (liveName) setServerContext({ domain: liveName.replace(/^files\./, '') });
                    if (typeof status?.quotaMb === 'number' && status.quotaMb > 0) {
                      setQuotaMb(String(status.quotaMb));
                    }
                  }}
                >
                  {t('publicFiles.discardDraft')}
                </Button>
              ) : null}
            </FormActions>
          </CardSection>
        </Card>

        <OpsResultPanel
          title={t('opsResult.title')}
          result={result}
          message={msg}
          busy={busy}
        />
        <ConfirmDialog
          open={applyOpen}
          onClose={() => !busy && setApplyOpen(false)}
          onConfirm={() => {
            setApplyOpen(false);
            void run(async () => {
              try {
                const r = (await systemApi.publicFilesApply({
                  serverName: formName,
                  quotaMb: quota.unlimited ? undefined : quota.value,
                  reload: true,
                  autoindex,
                })) as OpsResultLike & {
                  publicRoot?: string;
                  nginxReloaded?: boolean;
                  live?: boolean;
                  ok?: boolean;
                };
                await refreshStatus();
                return r;
              } catch (e) {
                const m = e instanceof Error ? e.message : t('common.applyFailed');
                return { ok: false, blocked: true, blockMessage: m, notes: [m] };
              }
            }, t('publicFiles.appliedOk'));
          }}
          title={t('publicFiles.applyConfirmTitle')}
          description={t('publicFiles.applyConfirmDesc', { name: serverName.trim() })}
          confirmLabel={t('publicFiles.applyReload')}
          busy={busy}
        />
      </WithPageGuide>
    </FeaturePageLayout>
  );
}
