/**
 * Shared runtime page — Node / Python / Go / Rust
 * Probe + install + panel tuning (env → deploy / systemd).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PageGuide,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  CheckboxField,
  DescriptionList,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  OpsResultPanel,
  PresetChips,
  SegRadio,
  SoftwareInstallBanner,
  PageTabs,
  buttonClassName,
} from '../../shared/components/ui';
import { Link, useSearchParams } from 'react-router-dom';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { useTranslation } from 'react-i18next';
import i18n from '../../shared/lib/i18n';
import {
  resolveRuntimeInstallState,
  versionChipLabel,
} from '../../features/runtimes/install-state';
import { RuntimePluginsField } from '../../features/runtimes/RuntimePluginsField';
import { RuntimeInstallActions } from '../../features/runtimes/RuntimeInstallActions';
import { bindSet, bindInput } from '../bind-handlers';

export type HostingRuntimeKind =
  | 'node'
  | 'php'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'kotlin'
  | 'bun';
type TuningKind = 'node' | 'python' | 'go' | 'rust';

/** Display meta only — version lists come from software/versions API (never hardcode pins). */
const META: Record<
  HostingRuntimeKind,
  {
    title: string;
    /** Offline placeholder until discovery returns */
    defaultVersion: string;
    installLabelKey: string;
    bannerTitle: string;
  }
> = {
  node: {
    title: 'Node.js',
    defaultVersion: '20',
    installLabelKey: 'runtime.installNodeLabel',
    bannerTitle: i18n.t('runtime.nodeMissing'),
  },
  php: {
    title: 'PHP',
    defaultVersion: '8.2',
    installLabelKey: 'runtime.installPhpLabel',
    bannerTitle: i18n.t('runtime.phpMissing'),
  },
  python: {
    title: 'Python',
    defaultVersion: '3.12',
    installLabelKey: 'runtime.installPythonLabel',
    bannerTitle: i18n.t('runtime.pythonMissing'),
  },
  go: {
    title: 'Go',
    defaultVersion: '1.22',
    installLabelKey: 'runtime.installGoLabel',
    bannerTitle: i18n.t('runtime.goMissing'),
  },
  rust: {
    title: 'Rust',
    defaultVersion: 'stable',
    installLabelKey: 'runtime.installRustLabel',
    bannerTitle: i18n.t('runtime.rustMissing'),
  },
  java: {
    title: 'Java',
    defaultVersion: '21',
    installLabelKey: 'runtime.installJavaLabel',
    bannerTitle: i18n.t('runtime.javaMissing'),
  },
  kotlin: {
    title: 'Kotlin',
    defaultVersion: '2.1.0',
    installLabelKey: 'runtime.installKotlinLabel',
    bannerTitle: i18n.t('runtime.kotlinMissing'),
  },
  bun: {
    title: 'Bun',
    defaultVersion: 'latest',
    installLabelKey: 'runtime.installBunLabel',
    bannerTitle: i18n.t('runtime.bunMissing'),
  },
};

const RT_TABS = ['overview', 'tuning', 'about'] as const;

type TuningGroup = {
  id: string;
  title: string;
  fields: Array<{
    key: string;
    label: string;
    type: string;
    default: string | number | boolean;
    hint?: string;
    options?: Array<{ value: string; label: string }>;
  }>;
};

export function isTuningKind(k: HostingRuntimeKind): k is TuningKind {
  return k === 'node' || k === 'python' || k === 'go' || k === 'rust';
}

/** Map ?version= from software hub to a panel-supported pin when possible. */
export function pickSupportedVersion(
  wanted: string,
  supported: string[],
  fallback: string,
): string {
  const w = wanted.trim().replace(/^v/i, '');
  if (!w || !supported.length) return fallback;
  if (supported.includes(w)) return w;
  // Major-only remote (e.g. 24) → highest panel pin with same major, else highest pin
  const major = w.split('.')[0] ?? w;
  const sameMajor = supported.filter(
    (s) => s === major || s.startsWith(`${major}.`) || (!s.includes('.') && s === major),
  );
  if (sameMajor.length) {
    return sameMajor.reduce((a, b) => {
      const pa = a.split(/[.+]/).map((x) => parseInt(x, 10) || 0);
      const pb = b.split(/[.+]/).map((x) => parseInt(x, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pb[i] ?? 0) - (pa[i] ?? 0);
        if (d !== 0) return d > 0 ? b : a;
      }
      return b;
    });
  }
  // Rolling channels
  if (supported.includes('stable') && /stable|latest/i.test(w)) return 'stable';
  if (supported.includes('latest') && /latest|stable/i.test(w)) return 'latest';
  return fallback;
}

export function GenericRuntimePage({ kind }: { kind: HostingRuntimeKind }) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const meta = META[kind];
  const [tab, setTab] = usePageTab(RT_TABS, 'overview');
  const [version, setVersion] = useState(meta.defaultVersion);
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const [catalog, setCatalog] = useState<TuningGroup[]>([]);
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [extraEnv, setExtraEnv] = useState('');
  const [envPreview, setEnvPreview] = useState<Record<string, string>>({});
  const [tuningLoaded, setTuningLoaded] = useState(false);
  const [plugins, setPlugins] = useState<string[]>([]);
  const [pluginsRefreshToken, setPluginsRefreshToken] = useState(0);
  const [versionStatus, setVersionStatus] = useState<{
    latestVersion?: string;
    currentVersion?: string;
    upgradable?: boolean;
    candidates: Array<{ version: string; label: string }>;
    source?: string;
    notes?: string[];
  } | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  // Reset plugin picks when switching runtime kind
  useEffect(() => {
    setPlugins([]);
    setVersionStatus(null);
  }, [kind]);

  // Dynamic upstream versions (no hardcoded chip list)
  useEffect(() => {
    let cancelled = false;
    void systemApi
      .softwareVersions({ id: kind, refresh: false })
      .then((h) => {
        if (cancelled) return;
        const candidates = (h.candidates ?? []).map((c) => ({
          version: c.version,
          label: c.label,
        }));
        setVersionStatus({
          latestVersion: h.latestVersion,
          currentVersion: h.currentVersion,
          upgradable: h.upgradable,
          candidates,
          source: h.source,
          notes: h.notes,
        });
        // Prefer discovered latest when user has not pinned via URL
        if (!searchParams.get('version') && h.latestVersion) {
          setVersion((prev) => prev || h.latestVersion || meta.defaultVersion);
        }
      })
      .catch(() => {
        if (!cancelled) setVersionStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, searchParams, meta.defaultVersion]);

  const refresh = useCallback(async () => {
    try {
      const r = (await systemApi.runtimes()) as Record<string, unknown>;
      setProbe(r);
    } catch {
      /* optional */
    }
  }, []);

  const loadTuning = useCallback(async () => {
    if (!isTuningKind(kind)) return;
    const r = await systemApi.runtimeTuningGet(kind, version);
    setCatalog(r.catalog);
    setValues({ ...r.settings.values });
    setExtraEnv(
      Object.entries(r.settings.env ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
    );
    setEnvPreview(r.envPreview ?? {});
    setTuningLoaded(true);
  }, [kind, version]);

  useEffect(() => {
    setVersion(meta.defaultVersion);
    setTuningLoaded(false);
    void refresh();
  }, [kind, meta.defaultVersion, refresh]);

  // Software hub / deep-link → ?version= (accept any shape-valid pin from discovery)
  useEffect(() => {
    const raw = searchParams.get('version');
    if (!raw) return;
    const supported = [
      ...(versionStatus?.candidates.map((c) => c.version) ?? []),
      ...((probe?.supported as Record<string, string[]> | undefined)?.[kind] ??
        []),
    ];
    setVersion(pickSupportedVersion(raw, supported, raw || meta.defaultVersion));
  }, [
    searchParams,
    kind,
    meta.defaultVersion,
    versionStatus?.candidates,
    probe?.supported,
  ]);

  useEffect(() => {
    if (tab === 'tuning' && isTuningKind(kind)) {
      void loadTuning().catch((e) =>
        setError(e instanceof Error ? e.message : t('runtime.tuneLoadFailed')),
      );
    }
  }, [tab, kind, version, loadTuning, setError]);

  const probeData = useMemo(() => {
    const p = probe?.probe as Record<string, unknown> | undefined;
    const supported = probe?.supported as Record<string, string[]> | undefined;
    const items = (p?.[kind] as Array<Record<string, unknown>> | undefined) ?? [];
    const available = items.filter((i) => i.available).map((i) => String(i.version));
    const hostKey =
      kind === 'node'
        ? 'hostNode'
        : kind === 'php'
          ? 'hostPhp'
          : kind === 'python'
            ? 'hostPython'
            : kind === 'go'
              ? 'hostGo'
              : kind === 'rust'
                ? 'hostRust'
                : kind === 'java'
                  ? 'hostJava'
                  : kind === 'kotlin'
                    ? 'hostKotlin'
                    : kind === 'bun'
                      ? 'hostBun'
                      : 'hostRust';
    const hostRaw = p?.[hostKey] != null ? String(p[hostKey]) : '';
    return {
      items,
      available,
      host: hostRaw || '—',
      hostRaw,
      supported:
        versionStatus?.candidates.map((c) => c.version).filter(Boolean) ??
        supported?.[kind] ??
        [],
      notes: Array.isArray(p?.notes) ? (p!.notes as string[]) : [],
    };
  }, [probe, kind, versionStatus?.candidates]);

  const multiVersion = kind === 'go' || kind === 'rust';
  const installState = useMemo(
    () =>
      resolveRuntimeInstallState({
        selectedVersion: version,
        supportedVersions: probeData.supported,
        availableVersions: probeData.available,
        probeItems: probeData.items.map((i) => ({
          version: i.version != null ? String(i.version) : undefined,
          available: Boolean(i.available),
          active: Boolean(i.active),
          versionOutput: i.versionOutput != null ? String(i.versionOutput) : undefined,
        })),
        hostDefault: probeData.hostRaw || null,
        multiVersion,
      }),
    [version, probeData, multiVersion],
  );

  const parseExtraEnv = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of extraEnv.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return out;
  };

  const setValue = (key: string, v: string | number | boolean) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  return (
    <FeaturePageLayout
      title={meta.title}
      status={{
        pill: {
          label: probeData.available.length
            ? t('runtime.availableCount', { n: probeData.available.length })
            : t('runtime.notDetected'),
          tone: probeData.available.length ? 'ok' : 'warn',
        },
        items: [
          {
            label: t('common.probe'),
            value: probe ? t('runtime.readShort') : '—',
            tone: probe ? 'ok' : 'neutral',
          },
          { label: t('common.available'), value: probeData.available.length || 0 },
          { label: t('common.target'), value: version },
          { label: t('runtime.tune'), value: tuningLoaded ? t('runtime.loadedShort') : '—' },
          { label: t('common.host'), value: probeData.host || '—' },
        ],
      }}
      actions={<>
          <Button
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
          <Link to="/projects" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('common.project')}
          </Link>
        </>
      }
    >
      <SoftwareInstallBanner feature={kind} title={meta.bannerTitle} />
      {error ? <Alert variant="error">{error}</Alert> : null}
      <PageTabs
        tabs={[
          { id: 'overview', label: t('runtime.tabOverviewInstall') },
          { id: 'tuning', label: t('runtime.tabTune') },
        
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'overview' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title={t('runtime.probeResult')} description={t('runtime.probeReadonlyInstall')}>
                <DescriptionList
                  columns={2}
                  items={[
                    { label: t('runtime.hostDefault'), value: probeData.host },
                    {
                      label: t('runtime.panelSupport'),
                      value: probeData.supported.join(', '),
                    },
                    {
                      label: t('ssl.status.ready'),
                      value: probeData.available.length ? (
                        <span /* was action-bar */>
                          {probeData.available.map((v) => (
                            <Badge key={v} tone="ok">
                              {v}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        t('runtime.notDetectedYet')
                      ),
                    },
                  ]}
                />
                {probeData.items.length > 0 ? (
                  <ul className="list-plain list-spaced u-mt-3">
                    {probeData.items.map((i) => (
                      <li key={String(i.version)}>
                        <strong>{String(i.version)}</strong>{' '}
                        <Badge tone={i.available ? 'ok' : 'neutral'}>
                          {i.available ? t('common.available') : t('runtime.notFound')}
                        </Badge>
                        {i.available && i.active ? (
                          <Badge tone="ok">
                            {t('runtime.activeDefault', { defaultValue: '預設' })}
                          </Badge>
                        ) : null}
                        {i.resolvedPath ? (
                          <span className="muted u-text-sm"> · {String(i.resolvedPath)}</span>
                        ) : null}
                        {i.versionOutput ? (
                          <span className="muted u-text-sm"> · {String(i.versionOutput)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted u-mt-2">{t('runtime.pressReprobeHost')}</p>
                )}
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title={t('common.install')}
                description={t('runtime.installHint')}
              >
                <FormLayout columns={2}>
                  <Field
                    label={t('runtime.targetVersion')}
                    htmlFor={`rt-${kind}-ver`}
                    flush
                    required
                    hint={
                      installState.installedVersions.length
                        ? t('runtime.installedVersionsHint', {
                            list: installState.installedVersions.join(', '),
                          })
                        : t('runtime.installScriptNote')
                    }
                  >
                    {(() => {
                      const vers = probeData.supported.length
                        ? probeData.supported
                        : version
                          ? [version]
                          : [];
                      if (!vers.length) {
                        return (
                          <input
                            id={`rt-${kind}-ver`}
                            value={version}
                            onChange={bindInput(setVersion)}
                            placeholder={t('runtime.versionPlaceholder', {
                              defaultValue: '載入最新版本中，或手動輸入',
                            })}
                          />
                        );
                      }
                      if (vers.length <= 8) {
                        return (
                          <SegRadio
                            name={`rt-${kind}-ver`}
                            aria-label={t('runtime.targetVersion')}
                            value={version}
                            onChange={setVersion}
                            options={vers.map((v) => ({
                              value: v,
                              label: versionChipLabel(v, installState.installedVersions),
                            }))}
                          />
                        );
                      }
                      return (
                        <select
                          id={`rt-${kind}-ver`}
                          value={version}
                          onChange={bindInput(setVersion)}
                        >
                          {vers.map((v) => (
                            <option key={v} value={v}>
                              {versionChipLabel(v, installState.installedVersions)}
                            </option>
                          ))}
                        </select>
                      );
                    })()}
                  </Field>
                </FormLayout>
                {versionStatus?.latestVersion ? (
                  <FormHint>
                    {t('runtime.remoteNewerHint', {
                      remote: versionStatus.latestVersion,
                      panel: versionStatus.currentVersion || '—',
                      defaultValue: `已裝 ${versionStatus.currentVersion || '—'} · 上游最新 ${versionStatus.latestVersion}${versionStatus.source ? `（${versionStatus.source}）` : ''}`,
                    })}
                  </FormHint>
                ) : versionStatus?.notes?.length ? (
                  <FormHint>
                    {versionStatus.notes.slice(0, 2).join(' · ')}
                  </FormHint>
                ) : null}
                <RuntimePluginsField
                  kind={kind}
                  value={plugins}
                  onChange={setPlugins}
                  disabled={busy}
                  refreshToken={pluginsRefreshToken}
                />
                <RuntimeInstallActions
                  installState={installState}
                  version={version}
                  busy={busy}
                  installLabel={t(meta.installLabelKey, { v: version })}
                  onSelectNewer={setVersion}
                  onSwitch={
                    multiVersion
                      ? () =>
                          void run(async () => {
                            const r = await systemApi.runtimeSwitch({
                              kind: kind as 'go' | 'rust',
                              version,
                            });
                            await refresh();
                            setPluginsRefreshToken((n) => n + 1);
                            return r as OpsResultLike;
                          }, t('runtime.switchDefaultBtn', { version }))
                      : undefined
                  }
                  extraHints={
                    multiVersion ? (
                      <FormHint>
                        {t('runtime.multiVersionHint', {
                          defaultValue:
                            'Go／Rust 可同時保留多個版本：先「安裝」缺少的版本，再「切換為預設」決定 PATH 用邊個。',
                        })}
                      </FormHint>
                    ) : installState.selectedInstalled ? (
                      <FormHint>{t('runtime.addonsInstallAbove')}</FormHint>
                    ) : installState.newerAvailable.length === 0 ? (
                      <FormHint>{t('runtime.installScriptNote')}</FormHint>
                    ) : null
                  }
                  onInstall={() =>
                    void run(async () => {
                      // Fresh runtime install may still bundle selected plugins
                      const r = await systemApi.runtimeInstall({
                        kind,
                        version,
                        install: true,
                        plugins,
                      });
                      await refresh();
                      // Force plugins catalog re-probe (installed chips)
                      setPluginsRefreshToken((n) => n + 1);
                      return r as OpsResultLike;
                    }, t(meta.installLabelKey, { v: version }))
                  }
                />
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'tuning' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={t('runtime.panelTune')}
                description={t('runtime.panelTuneDesc')}
              >
                <FormLayout columns={2}>
                  <Field label={t('runtime.bindVersion')} htmlFor={`tune-${kind}-ver`} flush>
                    {(() => {
                      const vers = probeData.supported.length
                        ? probeData.supported
                        : version
                          ? [version]
                          : [];
                      if (vers.length <= 8) {
                        return (
                          <SegRadio
                            name={`tune-${kind}-ver`}
                            aria-label={t('runtime.bindVersion')}
                            value={version}
                            onChange={setVersion}
                            options={vers.map((v) => ({ value: v, label: v }))}
                          />
                        );
                      }
                      return (
                        <select
                          id={`tune-${kind}-ver`}
                          value={version}
                          onChange={bindInput(setVersion)}
                        >
                          {vers.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      );
                    })()}
                  </Field>
                </FormLayout>
                <FormHint>
                  {t('runtime.envNote')}
                </FormHint>
              </CardSection>
            </Card>

            {catalog.map((group) => (
              <Card key={group.id}>
                <CardSection title={group.title} description={t('runtime.onePerRow')}>
                  <FormLayout columns={1}>
                    {group.fields.map((f) => {
                      const id = `tune-${kind}-${f.key}`;
                      const val = values[f.key] ?? f.default;
                      return (
                        <Field
                          key={f.key}
                          label={f.label}
                          htmlFor={id}
                          techKey={f.key}
                          hint={f.hint}
                          flush
                          fullWidth
                        >
                          {f.type === 'bool' ? (
                            <CheckboxField
                              id={id}
                              label={val === true || val === 1 || val === '1' ? t('common.open') : t('common.close')}
                              checked={val === true || val === 1 || val === '1'}
                              onChange={(c) => setValue(f.key, c)}
                            />
                          ) : f.type === 'select' && f.options ? (
                            (() => {
                              const cur = String(val ?? '');
                              const opts = f.options!;
                              const hasCur = !cur || opts.some((o) => o.value === cur);
                              const merged = hasCur
                                ? opts
                                : [{ value: cur, label: cur }, ...opts];
                              if (merged.length <= 8) {
                                const current = merged.some((o) => o.value === cur)
                                  ? cur
                                  : merged[0]!.value;
                                return (
                                  <SegRadio
                                    name={id}
                                    aria-label={f.label}
                                    value={current}
                                    onChange={(v) => setValue(f.key, v)}
                                    options={merged.map((o) => ({
                                      value: o.value,
                                      label: o.label,
                                    }))}
                                  />
                                );
                              }
                              return (
                                <select
                                  id={id}
                                  value={cur}
                                  onChange={(e) => setValue(f.key, e.target.value)}
                                  aria-label={f.label}
                                >
                                  {!cur ? <option value="" /> : null}
                                  {merged.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              );
                            })()
                          ) : f.type === 'int' ? (
                            <PresetChips
                              options={
                                f.key.includes('old_space') || f.key.includes('memory')
                                  ? [
                                      { value: '256', label: '256' },
                                      { value: '512', label: '512' },
                                      { value: '1024', label: '1024' },
                                      { value: '2048', label: '2048' },
                                    ]
                                  : f.key.includes('worker') || f.key.includes('thread')
                                    ? [
                                        { value: '1', label: '1' },
                                        { value: '2', label: '2' },
                                        { value: '4', label: '4' },
                                        { value: '8', label: '8' },
                                      ]
                                    : f.key === 'gogc'
                                      ? [
                                          { value: '50', label: '50' },
                                          { value: '100', label: '100' },
                                          { value: '200', label: '200' },
                                        ]
                                      : f.key === 'gomaxprocs'
                                        ? [
                                            { value: '0', label: t('runtime.zeroAll') },
                                            { value: '1', label: '1' },
                                            { value: '2', label: '2' },
                                            { value: '4', label: '4' },
                                          ]
                                        : [
                                            { value: '0', label: '0' },
                                            { value: '1', label: '1' },
                                            { value: '4', label: '4' },
                                            { value: '16', label: '16' },
                                          ]
                              }
                              value={String(val ?? f.default ?? '')}
                              onChange={(v) => setValue(f.key, Number(v))}
                              allowCustom
                              customPlaceholder={t('common.custom')}
                            />
                          ) : (
                            <input
                              id={id}
                              value={String(val ?? '')}
                              onChange={(e) => setValue(f.key, e.target.value)}
                              spellCheck={false}
                            />
                          )}
                        </Field>
                      );
                    })}
                  </FormLayout>
                </CardSection>
              </Card>
            ))}

            <Card>
              <CardSection title={t('runtime.extraEnv')} description={t('runtime.extraEnvHint')}>
                <FormLayout columns={1}>
                  <Field label={t('runtime.customEnv')} htmlFor={`tune-${kind}-extra`} flush fullWidth>
                    <textarea
                      id={`tune-${kind}-extra`}
                      rows={4}
                      value={extraEnv}
                      onChange={bindInput(setExtraEnv)}
                      placeholder="MY_APP_FLAG=1"
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
              </CardSection>
            </Card>

            {Object.keys(envPreview).length > 0 ? (
              <Card>
                <CardSection title={t('runtime.envPreview')} description={t('runtime.envPreviewDesc')}>
                  <DescriptionList
                    columns={1}
                    className="desc-list--env"
                    items={Object.entries(envPreview).map(([k, v]) => ({
                      label: k,
                      value: (
                        <code className="desc-list__code">
                          {v == null || v === '' ? '—' : String(v)}
                        </code>
                      ),
                    }))}
                  />
                </CardSection>
              </Card>
            ) : null}

            <FormActions>
              <Button
                variant="primary"
                size="md"
                loading={busy}
                disabled={!isTuningKind(kind)}
                onClick={() =>
                  void run(async () => {
                    if (!isTuningKind(kind)) return { ok: false, notes: [t('runtime.unsupported')] };
                    const r = await systemApi.runtimeTuningSave(kind, {
                      version,
                      values,
                      env: parseExtraEnv(),
                    });
                    await loadTuning();
                    return r as OpsResultLike;
                  }, t('runtime.tuneSaved'))
                }
              >
                {t('runtime.saveTune')}
              </Button>
              <Button
                variant="ghost"
                size="md"
                loading={busy}
                onClick={() =>
                  void loadTuning().catch((e) =>
                    setError(e instanceof Error ? e.message : t('runtime.reloadFailed')),
                  )
                }
              >
                {t('updates.reload')}
              </Button>
            </FormActions>
          </div>
        ) : null}
      
        {tab === 'about' ? (
          <PageGuide guideId={kind === 'php' ? 'php' : kind} />
        ) : null}
      </PageTabs>

      <OpsResultPanel title={t('systemd.opsResult')} result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}

export function NodeRuntimePage() {
  return <GenericRuntimePage kind="node" />;
}

export function PhpRuntimePageSimple() {
  return <GenericRuntimePage kind="php" />;
}

export function PythonRuntimePage() {
  return <GenericRuntimePage kind="python" />;
}

export function GoRuntimePage() {
  return <GenericRuntimePage kind="go" />;
}

export function RustRuntimePage() {
  return <GenericRuntimePage kind="rust" />;
}

export function JavaRuntimePage() {
  return <GenericRuntimePage kind="java" />;
}

export function KotlinRuntimePage() {
  return <GenericRuntimePage kind="kotlin" />;
}

export function BunRuntimePage() {
  return <GenericRuntimePage kind="bun" />;
}
