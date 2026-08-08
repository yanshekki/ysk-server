/**
 * Public files nginx site — Form Kit + DescriptionList.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  WithPageGuide,
  Alert,
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
  buttonClassName } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { getServerContext, setServerContext } from '../../shared/stores/server-context';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { Link } from 'react-router-dom';
import { bindSet } from '../bind-handlers';

export function PublicFilesPage() {
  const { t } = useTranslation();
  const ctx = getServerContext();
  const [serverName, setServerName] = useState(`files.${ctx.domain}`);
  const [quotaMb, setQuotaMb] = useState('1024');
  const { busy, error, result, msg, run, setMsg } = useFeatureAction();

  return (
    <FeaturePageLayout
      title={t('nav.publicFiles')}
      showCapability={false}
      status={{
        pill: {
          label: serverName || t('publicFiles.notSet'),
          tone: serverName ? 'ok' : 'warn' },
        items: [
          { label: 'server_name', value: serverName || t('common.noneSelectedShort') },
          {
            label: t('publicFiles.quota'),
            value: `${quotaMb || t('common.noneSelectedShort')} MiB` },
          { label: 'Reload', value: t('publicFiles.reloadOnApply') },
          { label: t('publicFiles.path'), value: 'dataDir/files' },
        ] }}
      actions={
        <>
          <Link to="/files" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('publicFiles.fileManager')}
          </Link>
          <Link to="/nginx" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
            Nginx
          </Link>
        </>
      }
    >
      <WithPageGuide guideId="publicFiles">
        {error ? <Alert variant="error">{error}</Alert> : null}
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
                  value: serverName || t('common.noneSelectedShort') },
                {
                  label: t('publicFiles.quota'),
                  value: `${quotaMb || t('common.noneSelectedShort')} MiB` },
                { label: t('publicFiles.reloadNginx'), value: t('publicFiles.reloadTry') },
              ]}
            />
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
                  placeholder="files.example.com"
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
            <FormHint>{t('publicFiles.applyHint')}</FormHint>
            <FormActions>
              <Button
                variant="primary"
                size="md"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    try {
                      return (await systemApi.publicFilesApply({
                        serverName,
                        quotaMb: Number(quotaMb) || undefined,
                        reload: true })) as OpsResultLike;
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
