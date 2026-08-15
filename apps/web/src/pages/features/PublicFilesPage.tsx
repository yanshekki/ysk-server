/**
 * Public files nginx site — settings + live status (honest 404 diagnostics).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  WithPageGuide,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
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

export function PublicFilesPage() {
  const { t } = useTranslation();
  const suggested = suggestedFilesHost();
  const [serverName, setServerName] = useState(suggested);
  const [quotaMb, setQuotaMb] = useState('1024');
  const [autoindex, setAutoindex] = useState(true);
  const { busy, error, result, msg, run, setMsg } = useFeatureAction();
  const [status, setStatus] = useState<FilesStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatusErr(null);
    try {
      const s = await systemApi.publicFilesStatus();
      setStatus(s);
      if (s.serverName && !serverName) setServerName(s.serverName);
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [serverName, t]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const liveTone = status?.likelyLive ? 'ok' : status?.managedConfExists ? 'warn' : 'danger';

  return (
    <FeaturePageLayout
      title={t('nav.publicFiles')}
      showCapability={false}
      status={{
        pill: {
          label: status?.likelyLive
            ? t('publicFiles.statusLive')
            : status?.managedConfExists
              ? t('publicFiles.statusManagedOnly')
              : t('publicFiles.statusNotApplied'),
          tone: liveTone,
        },
        items: [
          { label: 'server_name', value: serverName || t('common.noneSelectedShort') },
          {
            label: t('publicFiles.quota'),
            value: `${quotaMb || t('common.noneSelectedShort')} MiB`,
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
          {serverName ? (
            <a
              href={`http://${serverName}/`}
              target="_blank"
              rel="noreferrer"
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
              title={status?.likelyLive ? undefined : t('publicFiles.notLiveHint')}
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
                  label: t('publicFiles.serverName'),
                  value: serverName || t('common.noneSelectedShort'),
                },
                {
                  label: t('publicFiles.quota'),
                  value: `${quotaMb || t('common.noneSelectedShort')} MiB`,
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
                  label: 'EXECUTE',
                  value: status?.executeEnabled ? t('common.on') : t('common.off'),
                },
                {
                  label: 'Root',
                  value: status?.isRoot ? t('common.yes') : t('common.no'),
                },
              ]}
            />
            {status?.notes?.length ? (
              <ul className="u-mt-3 u-pl-5 muted u-text-sm">
                {status.notes.slice(0, 8).map((n) => (
                  <li key={n}>{n}</li>
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
              >
                <input
                  id="pf-sn"
                  value={serverName}
                  onChange={(e) => {
                    setServerName(e.target.value);
                    setServerContext({ domain: e.target.value.replace(/^files\./, '') });
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
                  value={quotaMb}
                  onChange={setQuotaMb}
                  allowCustom
                  customPlaceholder="MiB"
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
            <FormHint>{t('publicFiles.applyHint')}</FormHint>
            <FormActions>
              <Button
                variant="primary"
                size="md"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    try {
                      const r = (await systemApi.publicFilesApply({
                        serverName,
                        quotaMb: Number(quotaMb) || undefined,
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
                  }, t('publicFiles.appliedOk'))
                }
              >
                {t('publicFiles.applyReload')}
              </Button>
            </FormActions>
          </CardSection>
        </Card>

        <OpsResultPanel
          title={t('opsResult.title')}
          result={result}
          message={msg}
          busy={busy}
        />
      </WithPageGuide>
    </FeaturePageLayout>
  );
}
