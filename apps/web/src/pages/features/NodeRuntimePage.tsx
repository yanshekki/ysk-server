/**
 * Node.js runtime — probe + install with standard UX.
 */
import { useCallback, useEffect, useState } from 'react';
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
  SegRadio,
  SoftwareInstallBanner,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { bindSet } from '../bind-handlers';

export function NodeRuntimePage() {
  const { t } = useTranslation();
  const [version, setVersion] = useState('20');
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    try {
      const r = (await systemApi.runtimes()) as Record<string, unknown>;
      setProbe(r);
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const nodePath = probe?.nodePath ?? probe?.node ?? probe?.['node.version'];
  const hasNode = Boolean(
    probe &&
      (probe.node ||
        probe.nodeVersion ||
        probe.nodePath ||
        (typeof probe.ok === 'boolean' && probe.ok)),
  );

  return (
    <FeaturePageLayout
      title={t('nav.node', { defaultValue: 'Node.js' })}
      status={{
        pill: {
          label: probe ? t('common.probed') : t('common.notProbed'),
          tone: probe ? 'ok' : 'warn',
        },
        items: [
          {
            label: t('common.probe'),
            value: probe ? t('runtime.read') : t('common.notProbed'),
            tone: probe ? 'ok' : 'neutral',
          },
          { label: t('runtime.targetVersion'), value: version },
        ],
      }}
      actions={<Button
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={() => {
            setError(null);
            setMsg(null);
            void run(async () => {
              const r = (await systemApi.runtimes()) as Record<string, unknown>;
              setProbe(r);
              return { ok: true, notes: [t('common.probed')], ...r } as unknown as OpsResultLike;
            }, t('common.probed'));
          }}
        >
          {t('common.reprobe')}
        </Button>
      }
    >
      <WithPageGuide guideId="node">

      <SoftwareInstallBanner feature="node" title={t('runtime.nodeMissing')} />
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={bindSet(setMsg, null)}>
            {t('common.close')}
          </Button>
        </Alert>
      ) : null}

      {probe ? (
        <Card>
          <CardSection title={t('runtime.probeResult')} description={t('runtime.readonly')}>
            <DescriptionList
              columns={2}
              items={Object.entries(probe)
                .filter(([, v]) => v == null || typeof v !== 'object')
                .slice(0, 16)
                .map(([k, v]) => ({ label: k, value: String(v) }))}
            />
            {nodePath != null ? (
              <p className="muted u-text-sm u-mt-2">
                {t('redis.refPath', { path: String(nodePath) })}
              </p>
            ) : null}
          </CardSection>
        </Card>
      ) : null}

      <Card>
        <CardSection title={t('runtime.installNode')} description={t('runtime.needExecuteAdmin')}>
          <FormLayout columns={2}>
            <Field
              label={t('runtime.nodeMajor')}
              htmlFor="node-ver"
              flush
              required
              hint={t('runtime.nodeMajorHint')}
            >
              <SegRadio
                name="node-ver"
                aria-label={t('runtime.nodeMajor')}
                value={version}
                onChange={setVersion}
                options={[
                  { value: '18', label: '18' },
                  { value: '20', label: '20 LTS' },
                  { value: '22', label: '22' },
                ]}
              />
            </Field>
          </FormLayout>
          {hasNode ? (
            <FormHint>{t('runtime.nodeDetectedHint')}</FormHint>
          ) : (
            <FormHint>{t('runtime.nodeProbeAfter')}</FormHint>
          )}
          <FormActions>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const r = await systemApi.runtimeInstall({
                    kind: 'node',
                    version,
                    install: true,
                  });
                  await refresh();
                  return r as OpsResultLike;
                }, t('runtime.installedNode', { version }))
              }
            >
              {t('runtime.installNodeVBtn', { version })}
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      <OpsResultPanel title={t('db.opsResult')} result={result} message={msg} busy={busy} />
    
      </WithPageGuide>
    </FeaturePageLayout>
  );
}
