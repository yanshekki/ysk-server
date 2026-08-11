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
  InstallStreamPanel,
  PresetChips,
  SegRadio,
  ConfirmDialog,
  PageTabs,
  buttonClassName } from '../../shared/components/ui';
import { Link, useSearchParams } from 'react-router-dom';
import type { OpsResultLike, InstallStreamLine } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { useTranslation } from 'react-i18next';
import i18n from '../../shared/lib/i18n';
import {
  resolveRuntimeInstallState,
  supportsHostDefault,
  versionChipLabel } from '../../features/runtimes/install-state';
import { RuntimePluginsField } from '../../features/runtimes/RuntimePluginsField';
import { RuntimeInstallActions } from '../../features/runtimes/RuntimeInstallActions';
import { RuntimePm2Panel } from '../../features/runtimes/RuntimePm2Panel';
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
    bannerTitle: i18n.t('runtime.nodeMissing') },
  php: {
    title: 'PHP',
    defaultVersion: '8.2',
    installLabelKey: 'runtime.installPhpLabel',
    bannerTitle: i18n.t('runtime.phpMissing') },
  python: {
    title: 'Python',
    defaultVersion: '3.12',
    installLabelKey: 'runtime.installPythonLabel',
    bannerTitle: i18n.t('runtime.pythonMissing') },
  go: {
    title: 'Go',
    defaultVersion: '1.22',
    installLabelKey: 'runtime.installGoLabel',
    bannerTitle: i18n.t('runtime.goMissing') },
  rust: {
    title: 'Rust',
    defaultVersion: 'stable',
    installLabelKey: 'runtime.installRustLabel',
    bannerTitle: i18n.t('runtime.rustMissing') },
  java: {
    title: 'Java',
    defaultVersion: '21',
    installLabelKey: 'runtime.installJavaLabel',
    bannerTitle: i18n.t('runtime.javaMissing') },
  kotlin: {
    title: 'Kotlin',
    defaultVersion: '2.1.0',
    installLabelKey: 'runtime.installKotlinLabel',
    bannerTitle: i18n.t('runtime.kotlinMissing') },
  bun: {
    title: 'Bun',
    defaultVersion: 'latest',
    installLabelKey: 'runtime.installBunLabel',
    bannerTitle: i18n.t('runtime.bunMissing') } };

const RT_TABS_BASE = ['overview', 'software', 'tuning', 'about'] as const;
const RT_TABS_PROCESS = ['overview', 'software', 'processes', 'tuning', 'about'] as const;

export function runtimeTabsForKind(kind: HostingRuntimeKind): readonly string[] {
  return kind === 'node' || kind === 'bun' ? RT_TABS_PROCESS : RT_TABS_BASE;
}

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
  const tabs = useMemo(() => runtimeTabsForKind(kind), [kind]);
  const [tab, setTab] = usePageTab(tabs, 'overview');
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
  const [installLog, setInstallLog] = useState<InstallStreamLine[]>([]);

  // Reset plugin picks when switching runtime kind
  useEffect(() => {
    setPlugins([]);
    setVersionStatus(null);
    setInstallLog([]);
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
          label: c.label }));
        setVersionStatus({
          latestVersion: h.latestVersion,
          currentVersion: h.currentVersion,
          upgradable: h.upgradable,
          candidates,
          source: h.source,
          notes: h.notes });
        // No URL pin: always prefer discovered latest over offline META default
        // (do not use `prev || latest` — defaultVersion is truthy and would lock forever)
        const urlPin = searchParams.get('version');
        if (!urlPin && h.latestVersion) {
          setVersion(h.latestVersion);
        } else if (!urlPin && candidates[0]?.version) {
          setVersion(candidates[0].version);
        }
      })
      .catch(() => {
        if (!cancelled) setVersionStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, searchParams]);

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
    // Offline placeholder only until discovery returns; discovery overwrites with latest
    setVersion(meta.defaultVersion);
    setVersionStatus(null);
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
      notes: Array.isArray(p?.notes) ? (p!.notes as string[]) : [] };
  }, [probe, kind, versionStatus?.candidates]);

  /** Host path unsafe for project systemd user (mirrors core isProjectUserExecutablePath). */
  const nodePathSafety = useMemo(() => {
    if (kind !== 'node' && kind !== 'bun') return null;
    const path = (probeData.hostRaw || '').trim();
    const unsafe =
      Boolean(path) &&
      (path.startsWith('/root/') ||
        path.includes('/.hermes/') ||
        /\/\.(nvm|fnm|volta)\//.test(path) ||
        path.includes('/.local/share/fnm/'));
    const yskLike = /\/usr\/local\/ysk\/(node|bun)\//.test(path);
    // Only real probe counts as installed — never softwareVersions record
    const hasAvailable = probeData.available.length > 0;
    if (unsafe) {
      return { tone: 'warn' as const, kind: 'unsafe' as const, path };
    }
    if (!hasAvailable && !yskLike) {
      return { tone: 'info' as const, kind: 'yskMissing' as const, path: path || '—' };
    }
    if (yskLike || (hasAvailable && path && !unsafe)) {
      return { tone: 'ok' as const, kind: 'ok' as const, path };
    }
    return null;
  }, [kind, probeData.hostRaw, probeData.available.length]);

  const multiVersion = kind === 'go' || kind === 'rust';
  const hostDefaultOk = supportsHostDefault(kind);
  /** Control-plane pin only — never treat as "installed" without probe. */
  const recordedPin =
    versionStatus?.currentVersion != null
      ? String(versionStatus.currentVersion).replace(/^v/i, '')
      : '';
  const recordedButProbeEmpty =
    Boolean(recordedPin) && probeData.available.length === 0;

  const installState = useMemo(() => {
    // Installed = host probe only (same as PHP/Go). softwareVersions is not proof.
    return resolveRuntimeInstallState({
      selectedVersion: version,
      supportedVersions: probeData.supported,
      availableVersions: probeData.available,
      probeItems: probeData.items.map((i) => ({
        version: i.version != null ? String(i.version) : undefined,
        available: Boolean(i.available),
        active: Boolean(i.active),
        versionOutput: i.versionOutput != null ? String(i.versionOutput) : undefined })),
      hostDefault: probeData.hostRaw || null,
      multiVersion,
      kind,
    });
  }, [version, probeData, multiVersion, kind]);

  const [defaultConfirmOpen, setDefaultConfirmOpen] = useState(false);

  const runSwitchDefault = useCallback(
    (targetVersion: string) =>
      void run(async () => {
        const r = await systemApi.runtimeSwitch({
          kind: kind as 'go' | 'rust' | 'node' | 'bun',
          version: targetVersion,
        });
        await refresh();
        setPluginsRefreshToken((n) => n + 1);
        return r as OpsResultLike;
      }, t('runtime.switchDefaultBtn', { version: targetVersion })),
    [kind, run, refresh, t],
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
        pill: (() => {
          if (probeData.available.length) {
            return {
              label: t('runtime.availableCount', { n: probeData.available.length }),
              tone: 'ok' as const };
          }
          // Never show "recorded installed" as ready — probe empty = not detected
          return { label: t('runtime.notDetected'), tone: 'warn' as const };
        })(),
        items: [
          {
            label: t('common.probe'),
            value: probe ? t('runtime.readShort') : '—',
            tone: probe ? 'ok' : 'neutral' },
          {
            label: t('common.available'),
            value: probeData.available.length },
          { label: t('common.target'), value: version },
          { label: t('runtime.tune'), value: tuningLoaded ? t('runtime.loadedShort') : '—' },
          { label: t('common.host'), value: probeData.host || '—' },
        ] }}
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
      {error ? <Alert variant="error">{error}</Alert> : null}
      {nodePathSafety?.kind === 'unsafe' ? (
        <Alert variant="warn">
          <strong>{t('runtime.nodePathUnsafeTitle')}</strong>{' '}
          {t('runtime.nodePathUnsafe', { path: nodePathSafety.path })}
        </Alert>
      ) : null}
      {nodePathSafety?.kind === 'yskMissing' ? (
        <Alert variant="info">
          <strong>{t('runtime.nodePathYskMissingTitle')}</strong>{' '}
          {t('runtime.nodePathYskMissing', { version: version || '…' })}
        </Alert>
      ) : null}
      {recordedButProbeEmpty ? (
        <Alert variant="warn">
          {t('runtime.recordedButProbeEmpty', { v: recordedPin })}
        </Alert>
      ) : null}
      <PageTabs
        tabs={[
          { id: 'overview', label: t('runtime.overview') },
          { id: 'software', label: t('runtime.tabSoftware') },
          ...(kind === 'node' || kind === 'bun'
            ? [{ id: 'processes', label: t('runtime.tabProcesses') }]
            : []),
          { id: 'tuning', label: t('runtime.tabTune') },
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'processes' && (kind === 'node' || kind === 'bun') ? (
          <div className="tab-panel">
            <RuntimePm2Panel runtimes={kind === 'bun' ? 'bun' : 'node,bun'} />
          </div>
        ) : null}
        {tab === 'overview' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title={t('runtime.probeResult')} description={t('runtime.probeReadonly')}>
                <DescriptionList
                  columns={2}
                  items={[
                    { label: t('runtime.hostDefault'), value: probeData.host },
                    {
                      label: t('runtime.panelSupport'),
                      value: probeData.supported.join(', ') || '—',
                    },
                    {
                      label: t('ssl.status.ready'),
                      value: probeData.available.length ? (
                        <span>
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
                        {i.available &&
                        (i.active ||
                          (probeData.hostRaw &&
                            String(i.versionOutput || i.version).includes(
                              String(i.version),
                            ) &&
                            installState.selectedActive &&
                            String(i.version) === version)) ? (
                          <Badge tone="ok">{t('runtime.activeDefault')}</Badge>
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
                <FormHint>
                  {t('runtime.overviewSoftwareHint')}{' '}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => setTab('software')}
                  >
                    {t('runtime.tabSoftware')}
                  </button>
                </FormHint>
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'software' ? (
          <div className="tab-panel">
            {installState.selectedInstalled ? (
              <Alert variant="info">
                <strong>
                  {t('runtime.versionReadyTitle', {
                    name: meta.title,
                    version,
                  })}
                </strong>{' '}
                {t('runtime.versionReadyHint')}
              </Alert>
            ) : null}
            <Card>
              <CardSection
                title={t('runtime.softwareVersionTitle', { version })}
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
                            list: installState.installedVersions.join(', ') })
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
                            placeholder={t('runtime.versionPlaceholder', { })}
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
                              label: versionChipLabel(v, installState.installedVersions) }))}
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
                      // Probed installs only — never softwareVersions.currentVersion as "installed"
                      current:
                        installState.installedVersions.join(', ') ||
                        (probeData.hostRaw ? probeData.hostRaw : '—'),
                      panel:
                        installState.installedVersions.join(', ') ||
                        (probeData.hostRaw ? probeData.hostRaw : '—'),
                      source: versionStatus.source
                        ? t('runtime.remoteSourceSuffix', {
                            source: versionStatus.source })
                        : '' })}
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
                  // Only one primary install CTA: plugins when runtime already on host
                  showInstallButton={installState.selectedInstalled}
                />
                {!installState.selectedInstalled || hostDefaultOk ? (
                  <RuntimeInstallActions
                    installState={installState}
                    version={version}
                    busy={busy}
                    installLabel={t(meta.installLabelKey, { v: version })}
                    onSelectNewer={setVersion}
                    onSwitch={
                      hostDefaultOk && installState.canSwitch
                        ? () => setDefaultConfirmOpen(true)
                        : undefined
                    }
                    extraHints={
                      hostDefaultOk ? (
                        <FormHint>{t('runtime.multiVersionHint')}</FormHint>
                      ) : installState.newerAvailable.length === 0 ? (
                        <FormHint>{t('runtime.installScriptNote')}</FormHint>
                      ) : null
                    }
                    onInstall={() =>
                      void run(async () => {
                        setInstallLog([]);
                        const r = await systemApi.runtimeInstallStream(
                          {
                            kind,
                            version,
                            install: true,
                            plugins,
                          },
                          {
                            onLog: (line) =>
                              setInstallLog((prev) => [...prev.slice(-1999), line]),
                          },
                        );
                        await refresh();
                        setPluginsRefreshToken((n) => n + 1);
                        return r as OpsResultLike;
                      }, t(meta.installLabelKey, { v: version }))
                    }
                  />
                ) : null}
                {installState.selectedInstalled &&
                hostDefaultOk &&
                installState.selectedActive ? (
                  <FormHint>
                    <Badge tone="ok">{t('runtime.alreadyHostDefault', { version })}</Badge>
                  </FormHint>
                ) : null}
                {!hostDefaultOk ? (
                  <FormHint>{t('runtime.hostDefaultUnsupported')}</FormHint>
                ) : null}
                <InstallStreamPanel lines={installLog} busy={busy} />
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title={t('runtime.versionInventory')}
                description={t('runtime.versionInventoryDesc')}
              >
                {probeData.supported.length === 0 ? (
                  <p className="muted">{t('runtime.pressReprobeHost')}</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('runtime.targetVersion')}</th>
                          <th>{t('common.status')}</th>
                          <th>{t('runtime.hostDefault')}</th>
                          <th>{t('common.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {probeData.supported.map((v) => {
                          const rowState = resolveRuntimeInstallState({
                            selectedVersion: v,
                            supportedVersions: probeData.supported,
                            availableVersions: probeData.available,
                            probeItems: probeData.items.map((i) => ({
                              version:
                                i.version != null ? String(i.version) : undefined,
                              available: Boolean(i.available),
                              active: Boolean(i.active),
                              versionOutput:
                                i.versionOutput != null
                                  ? String(i.versionOutput)
                                  : undefined,
                            })),
                            hostDefault: probeData.hostRaw || null,
                            multiVersion,
                            kind,
                          });
                          return (
                            <tr
                              key={v}
                              className={v === version ? 'is-selected' : undefined}
                            >
                              <td>
                                <button
                                  type="button"
                                  className="linkish"
                                  onClick={() => setVersion(v)}
                                >
                                  <strong>{v}</strong>
                                </button>
                              </td>
                              <td>
                                <Badge
                                  tone={rowState.selectedInstalled ? 'ok' : 'neutral'}
                                >
                                  {rowState.selectedInstalled
                                    ? t('common.installed')
                                    : t('common.notInstalled')}
                                </Badge>
                              </td>
                              <td>
                                {rowState.selectedActive ? (
                                  <Badge tone="ok">{t('runtime.activeDefault')}</Badge>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td>
                                <span className="action-bar action-bar--sm">
                                  {!rowState.selectedInstalled ? (
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => {
                                        setVersion(v);
                                      }}
                                    >
                                      {t('runtime.selectToInstall')}
                                    </Button>
                                  ) : null}
                                  {hostDefaultOk &&
                                  rowState.selectedInstalled &&
                                  !rowState.selectedActive ? (
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      loading={busy}
                                      onClick={() => {
                                        setVersion(v);
                                        setDefaultConfirmOpen(true);
                                      }}
                                    >
                                      {t('runtime.setHostDefault')}
                                    </Button>
                                  ) : null}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardSection>
            </Card>

            <details className="u-mt-3">
              <summary className="muted u-text-sm">
                {t('runtime.advancedFeatureUninstall')}
              </summary>
              <p className="muted u-text-sm u-mt-2">
                {t('runtime.advancedFeatureUninstallHint', { name: meta.title })}
              </p>
            </details>
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
                                      label: o.label }))}
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
                      ) }))}
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
                      env: parseExtraEnv() });
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

      <ConfirmDialog
        open={defaultConfirmOpen}
        onClose={() => setDefaultConfirmOpen(false)}
        onConfirm={() => {
          setDefaultConfirmOpen(false);
          runSwitchDefault(version);
        }}
        title={t('runtime.setHostDefaultConfirmTitle', { version })}
        description={t('runtime.setHostDefaultConfirm', { version })}
        severity="standard"
        confirmLabel={t('runtime.setHostDefault')}
        cancelLabel={t('common.cancel')}
        busy={busy}
      />
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
