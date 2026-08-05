/**
 * Node.js runtime — probe + install Node + PM2 with standard UX.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  SegRadio,
  SoftwareInstallBanner,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { softwareApi } from '../../features/software';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { useFeatureSoftware } from '../../features/software';
import {
  resolveRuntimeInstallState,
  versionChipLabel,
} from '../../features/runtimes/install-state';
import { bindSet } from '../bind-handlers';

export function NodeRuntimePage() {
  const { t } = useTranslation();
  const [version, setVersion] = useState('20');
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();
  const {
    items: softItems,
    missing,
    refresh: refreshSoft,
    busy: softBusy,
  } = useFeatureSoftware('node');

  const refresh = useCallback(async () => {
    try {
      const r = (await systemApi.runtimes()) as Record<string, unknown>;
      setProbe(r);
    } catch {
      /* optional */
    }
    await refreshSoft().catch(() => undefined);
  }, [refreshSoft]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // API shape: { supported, probe: { hostNode, node: RuntimeProbeItem[], ... } }
  const probeInner = useMemo(() => {
    const p = (probe?.probe as Record<string, unknown> | undefined) ?? probe;
    return p && typeof p === 'object' ? p : null;
  }, [probe]);

  const hostNode =
    probeInner?.hostNode != null && String(probeInner.hostNode).trim()
      ? String(probeInner.hostNode)
      : null;
  const nodeItems = Array.isArray(probeInner?.node)
    ? (probeInner!.node as Array<Record<string, unknown>>)
    : [];
  const availableMajors = useMemo(
    () => nodeItems.filter((i) => i.available).map((i) => String(i.version)),
    [nodeItems],
  );
  const installState = useMemo(
    () =>
      resolveRuntimeInstallState({
        selectedVersion: version,
        supportedVersions: ['18', '20', '22'],
        availableVersions: availableMajors,
        probeItems: nodeItems.map((i) => ({
          version: i.version != null ? String(i.version) : undefined,
          available: Boolean(i.available),
          versionOutput: i.versionOutput != null ? String(i.versionOutput) : undefined,
        })),
        hostDefault: hostNode,
      }),
    [version, availableMajors, nodeItems, hostNode],
  );
  const softNode = softItems.find((s) => s.id === 'node');
  const hasNode = Boolean(
    hostNode ||
      availableMajors.length > 0 ||
      installState.anyInstalled ||
      softNode?.installed ||
      (!missing.some((m) => m.id === 'node') && softItems.length > 0 && softNode),
  );
  const nodePath =
    hostNode ??
    (nodeItems.find((i) => i.available && i.resolvedPath)?.resolvedPath as string | undefined) ??
    null;
  const pm2Status = softItems.find((s) => s.id === 'pm2');
  const hasPm2 = Boolean(pm2Status?.installed);
  const nodeMissing = missing.some((m) => m.id === 'node') && !hasNode;
  const pm2Missing = missing.some((m) => m.id === 'pm2');

  return (
    <FeaturePageLayout
      title={t('nav.node', { defaultValue: 'Node.js' })}
      status={{
        pill: {
          label: hasNode
            ? t('runtime.pm2Ready')
            : probe
              ? t('common.probed')
              : t('common.notProbed'),
          tone: hasNode ? 'ok' : probe ? 'warn' : 'neutral',
        },
        items: [
          {
            label: 'Node.js',
            value: hasNode
              ? hostNode ?? t('runtime.pm2Ready')
              : probe
                ? t('runtime.pm2MissingShort')
                : t('common.notProbed'),
            tone: hasNode ? 'ok' : 'warn',
          },
          { label: t('runtime.targetVersion'), value: version },
          {
            label: 'PM2',
            value: hasPm2 ? t('runtime.pm2Ready') : t('runtime.pm2MissingShort'),
            tone: hasPm2 ? 'ok' : 'warn',
          },
        ],
      }}
      actions={<Button
          variant="secondary"
          size="sm"
          loading={busy || softBusy}
          onClick={() => {
            setError(null);
            setMsg(null);
            void run(async () => {
              await refresh();
              return { ok: true, notes: [t('common.probed')] } as OpsResultLike;
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

      {probeInner ? (
        <Card>
          <CardSection title={t('runtime.probeResult')} description={t('runtime.readonly')}>
            <DescriptionList
              columns={2}
              items={[
                {
                  label: 'hostNode',
                  value: hostNode ?? t('runtime.pm2MissingShort'),
                },
                {
                  label: t('runtime.nodeMajor'),
                  value: availableMajors.length ? availableMajors.join(', ') : '—',
                },
                ...(nodePath
                  ? [{ label: 'PATH', value: String(nodePath) }]
                  : []),
              ]}
            />
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
                  {
                    value: '18',
                    label: versionChipLabel('18', installState.installedVersions),
                  },
                  {
                    value: '20',
                    label: installState.installedVersions.includes('20')
                      ? '20 ✓'
                      : '20 LTS',
                  },
                  {
                    value: '22',
                    label: versionChipLabel('22', installState.installedVersions),
                  },
                ]}
              />
            </Field>
          </FormLayout>
          {installState.selectedInstalled ? (
            <FormHint>{t('runtime.versionAlreadyInstalled', { version })}</FormHint>
          ) : installState.newerAvailable.length > 0 ? (
            <FormHint>
              {t('runtime.newerVersionAvailable', {
                current: installState.newestInstalled ?? hostNode ?? '—',
                newer: installState.newerAvailable.join(', '),
              })}
            </FormHint>
          ) : hasNode ? (
            <FormHint>{t('runtime.nodeDetectedHint')}</FormHint>
          ) : (
            <FormHint>{t('runtime.nodeProbeAfter')}</FormHint>
          )}
          <FormActions>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={installState.installDisabled}
              title={
                installState.installDisabled
                  ? t('runtime.versionAlreadyInstalled', { version })
                  : undefined
              }
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
              {installState.installDisabled
                ? t('runtime.installedVersionBtn', { version })
                : t('runtime.installNodeVBtn', { version })}
            </Button>
            {installState.newerAvailable[0] && installState.installDisabled ? (
              <Button
                variant="secondary"
                size="md"
                loading={busy}
                onClick={() => setVersion(installState.newerAvailable[0]!)}
              >
                {t('runtime.switchToNewer', {
                  version: installState.newerAvailable[0],
                })}
              </Button>
            ) : null}
          </FormActions>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title={t('runtime.installPm2')}
          description={t('runtime.installPm2Desc')}
        >
          <p className="u-mb-2">
            <strong>{t('runtime.pm2Status')}：</strong>
            {hasPm2 ? (
              <Badge tone="ok">{t('runtime.pm2Ready')}</Badge>
            ) : (
              <Badge tone="warn">{t('runtime.pm2MissingShort')}</Badge>
            )}
          </p>
          <FormHint>
            {nodeMissing || !hasNode
              ? t('runtime.pm2NeedNodeFirst')
              : hasPm2
                ? t('runtime.pm2ReadyHint')
                : t('runtime.pm2InstallHint')}
          </FormHint>
          <FormActions>
            <Button
              variant="primary"
              size="md"
              loading={softBusy || busy}
              disabled={!hasNode && !hasPm2}
              onClick={() =>
                void run(async () => {
                  const r = await softwareApi.installOne('pm2');
                  await refresh();
                  return r as unknown as OpsResultLike;
                }, t('runtime.installedPm2'))
              }
            >
              {hasPm2 ? t('runtime.reinstallPm2') : t('runtime.installPm2Btn')}
            </Button>
            {pm2Missing || !hasPm2 ? (
              <Button
                variant="secondary"
                size="md"
                loading={softBusy}
                onClick={() => void refreshSoft()}
              >
                {t('common.reprobe')}
              </Button>
            ) : null}
          </FormActions>
        </CardSection>
      </Card>

      {result ? (
        <OpsResultPanel title={t('db.opsResult')} result={result} busy={busy || softBusy} />
      ) : null}
    
      </WithPageGuide>
    </FeaturePageLayout>
  );
}
