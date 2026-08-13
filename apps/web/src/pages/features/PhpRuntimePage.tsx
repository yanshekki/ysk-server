/**
 * PHP runtime — Overview · php.ini · FPM/站點 · 工具
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import i18n from '../../shared/lib/i18n';
import { pickSupportedVersion } from './GenericRuntimePage';
import {
  PageGuide,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  CheckboxField,
  ConfirmDialog,
  DescriptionList,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  MultiCheckSelect,
  OpsResultPanel,
  PresetChips,
  SegRadio,
  PageTabs } from '../../shared/components/ui';
import type { OpsResultLike, MultiCheckOption } from '../../shared/components/ui';
import { useOpsStreamOptional } from '../../shared/ops-stream/OpsStreamContext';
import { getServerContext, setServerContext } from '../../shared/stores/server-context';
import { systemApi } from '../../features/system';
import { ServiceLifecycleBar } from '../../features/system/ServiceLifecycleBar';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { resolveRuntimeInstallState } from '../../features/runtimes/install-state';
import { RuntimeSoftwarePanel } from '../../features/runtimes/RuntimeSoftwarePanel';
import { api } from '../../shared/services/api';
import { toast } from '../../shared/stores/toast-store';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { bindSet, bindInput } from '../bind-handlers';

type PhpExtRow = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  recommended: boolean;
  required: boolean;
  package: string;
  installed?: boolean;
};

type ToolsProbe = {
  php?: { version?: string; modules: string[] };
  composer?: { available: boolean; version?: string };
  wpCli?: { available: boolean; version?: string };
  notes?: string[];
};

/** Common int / bytes presets for selection-first php.ini rows */
function phpIniPresets(
  key: string,
  kind: 'int' | 'bytes',
): Array<{ value: string; label: string }> {
  if (kind === 'bytes') {
    if (key.includes('memory') || key === 'memory_limit') {
      return [
        { value: '128M', label: '128M' },
        { value: '256M', label: '256M' },
        { value: '512M', label: '512M' },
        { value: '1G', label: '1G' },
        { value: '-1', label: i18n.t('runtime.unlimited') },
      ];
    }
    // realpath_cache_size is typically KiB, not multi-MB like upload limits
    if (key === 'realpath_cache_size') {
      return [
        { value: '512K', label: '512K' },
        { value: '1024K', label: '1024K' },
        { value: '2048K', label: '2048K' },
        { value: '4096K', label: '4096K' },
        { value: '8192K', label: '8192K' },
      ];
    }
    return [
      { value: '8M', label: '8M' },
      { value: '32M', label: '32M' },
      { value: '64M', label: '64M' },
      { value: '128M', label: '128M' },
      { value: '256M', label: '256M' },
    ];
  }
  switch (key) {
    case 'max_execution_time':
    case 'max_input_time':
      return [
        { value: '0', label: i18n.t('runtime.zeroUnlimited') },
        { value: '30', label: '30' },
        { value: '60', label: '60' },
        { value: '120', label: '120' },
        { value: '300', label: '300' },
      ];
    case 'realpath_cache_ttl':
      return [
        { value: '60', label: '60' },
        { value: '120', label: '120' },
        { value: '300', label: '300' },
        { value: '600', label: '600' },
      ];
    case 'cgi.fix_redirect':
      return [
        { value: '0', label: '0' },
        { value: '1', label: '1' },
      ];
    case 'max_input_vars':
      return [
        { value: '1000', label: '1000' },
        { value: '2500', label: '2500' },
        { value: '5000', label: '5000' },
        { value: '10000', label: '10000' },
      ];
    case 'max_input_nesting_level':
      return [
        { value: '32', label: '32' },
        { value: '64', label: '64' },
        { value: '128', label: '128' },
      ];
    case 'max_file_uploads':
      return [
        { value: '5', label: '5' },
        { value: '20', label: '20' },
        { value: '50', label: '50' },
        { value: '100', label: '100' },
      ];
    case 'session.gc_maxlifetime':
      return [
        { value: '1440', label: i18n.t('runtime.m24') },
        { value: '3600', label: i18n.t('runtime.h1') },
        { value: '86400', label: i18n.t('runtime.d1') },
        { value: '604800', label: i18n.t('runtime.d7') },
      ];
    case 'opcache.memory_consumption':
      return [
        { value: '64', label: '64' },
        { value: '128', label: '128' },
        { value: '256', label: '256' },
        { value: '512', label: '512' },
      ];
    case 'opcache.interned_strings_buffer':
      return [
        { value: '8', label: '8' },
        { value: '16', label: '16' },
        { value: '32', label: '32' },
        { value: '64', label: '64' },
      ];
    case 'opcache.max_accelerated_files':
      return [
        { value: '4000', label: '4k' },
        { value: '10000', label: '10k' },
        { value: '20000', label: '20k' },
        { value: '100000', label: '100k' },
      ];
    case 'opcache.revalidate_freq':
      return [
        { value: '0', label: '0' },
        { value: '2', label: '2' },
        { value: '10', label: '10' },
        { value: '60', label: '60' },
      ];
    default:
      return [
        { value: '0', label: '0' },
        { value: '1', label: '1' },
        { value: '10', label: '10' },
        { value: '100', label: '100' },
      ];
  }
}

type IniCatalogGroup = {
  id: string;
  title: string;
  description?: string;
  fields: Array<{
    key: string;
    label: string;
    type: string;
    default: string | number | boolean;
    hint?: string;
    danger?: boolean;
    options?: Array<{ value: string; label: string; group?: string }>;
  }>;
};

const PHP_TABS = ['overview', 'software', 'ini', 'site', 'tools', 'about'] as const;

export function PhpRuntimePage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const ctx = getServerContext();
  const [tab, setTab] = usePageTab(PHP_TABS, 'overview');
  const [domain, setDomain] = useState(`php.${ctx.domain}`);
  const [poolName, setPoolName] = useState('demo');
  const [version, setVersion] = useState('8.2');
  const [phpCandidates, setPhpCandidates] = useState<string[]>([]);
  const [enableSite, setEnableSite] = useState(false);
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const [tools, setTools] = useState<ToolsProbe | null>(null);
  const [catalog, setCatalog] = useState<IniCatalogGroup[]>([]);
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [extraText, setExtraText] = useState('');
  const [rawAppend, setRawAppend] = useState('');
  const [managedPath, setManagedPath] = useState('');
  const [iniUpdatedAt, setIniUpdatedAt] = useState<string | undefined>();
  const [iniLoaded, setIniLoaded] = useState(false);
  const [extCatalog, setExtCatalog] = useState<PhpExtRow[]>([]);
  const [extSelected, setExtSelected] = useState<string[]>([]);
  const [extDefaults, setExtDefaults] = useState<string[]>([]);
  const [extUninstallBusy, setExtUninstallBusy] = useState(false);
  const [confirmExtUninstall, setConfirmExtUninstall] = useState<PhpExtRow | null>(null);
  const [confirmPhpUninstall, setConfirmPhpUninstall] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<string | null>(null);
  const [hostDefaultConfirm, setHostDefaultConfirm] = useState<string | null>(null);
  const [panelDefault, setPanelDefault] = useState<string | null>(null);
  const [extOps, setExtOps] = useState<OpsResultLike | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();
  const stream = useOpsStreamOptional();

  // Dynamic PHP minors from upstream (no hardcoded 8.1/8.2/8.3 chips)
  useEffect(() => {
    let cancelled = false;
    void systemApi
      .softwareVersions({ id: 'php' })
      .then((h) => {
        if (cancelled) return;
        const cands = (h.candidates ?? []).map((c) => c.version).filter(Boolean);
        setPhpCandidates(cands);
        // Prefer discovered latest; do not lock on initial '8.2' via `prev ||`
        if (!searchParams.get('version')) {
          if (h.latestVersion) setVersion(h.latestVersion);
          else if (cands[0]) setVersion(cands[0]);
        }
      })
      .catch(() => {
        if (!cancelled) setPhpCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  // Software hub "更新" → /runtimes/php?version=8.3
  useEffect(() => {
    const raw = searchParams.get('version');
    if (!raw) return;
    setVersion(pickSupportedVersion(raw, phpCandidates, raw));
  }, [searchParams, phpCandidates]);

  const hostPhp = useMemo(() => {
    const p = (probe?.probe as Record<string, unknown> | undefined) ?? undefined;
    return p?.hostPhp != null ? String(p.hostPhp) : '';
  }, [probe]);

  const phpInstallState = useMemo(() => {
    const p = (probe?.probe as Record<string, unknown> | undefined) ?? undefined;
    const supported =
      phpCandidates.length > 0
        ? phpCandidates
        : (probe?.supported as Record<string, string[]> | undefined)?.php ?? [];
    const items = (p?.php as Array<Record<string, unknown>> | undefined) ?? [];
    const available = items.filter((i) => i.available).map((i) => String(i.version));
    return resolveRuntimeInstallState({
      selectedVersion: version,
      supportedVersions: supported.length ? supported : version ? [version] : [],
      availableVersions: available,
      probeItems: items.map((i) => ({
        version: i.version != null ? String(i.version) : undefined,
        available: Boolean(i.available),
        versionOutput: i.versionOutput != null ? String(i.versionOutput) : undefined,
      })),
      hostDefault: hostPhp || null,
      kind: 'php',
    });
  }, [probe, version, phpCandidates, hostPhp]);

  const refresh = useCallback(async () => {
    try {
      const r = (await systemApi.runtimes()) as Record<string, unknown>;
      setProbe(r);
      const pd = r.panelDefaults as Record<string, string> | undefined;
      if (pd?.php) setPanelDefault(String(pd.php));
    } catch {
      /* optional */
    }
    try {
      setTools(await api.requestRaw<ToolsProbe>('/api/v1/runtimes/tools'));
    } catch {
      /* optional */
    }
    try {
      const h = await systemApi.softwareVersions({ id: 'php', refresh: true });
      setPhpCandidates((h.candidates ?? []).map((c) => c.version).filter(Boolean));
    } catch {
      /* optional */
    }
  }, []);

  const phpVersionOptions = useMemo(() => {
    const set = new Set([
      ...phpCandidates,
      ...phpInstallState.installedVersions,
      version,
    ].filter(Boolean));
    return [...set];
  }, [phpCandidates, phpInstallState.installedVersions, version]);

  const loadExtensions = useCallback(
    async (ver: string, opts?: { bust?: boolean; optimisticInstalled?: string[] }) => {
      try {
        // Prefer unified addons API; fall back to legacy php/extensions
        let extensions: PhpExtRow[] = [];
        let defaults: string[] = [];
        const bust = Boolean(opts?.bust);
        const optSet = new Set(opts?.optimisticInstalled ?? []);
        try {
          const r = await systemApi.runtimeAddons('php', ver, { bust });
          extensions = (r.items ?? []).map((e) => ({
            id: e.id,
            group: e.group ?? 'other',
            label: e.label,
            hint: e.hint,
            recommended: Boolean(e.recommended),
            required: Boolean(e.required),
            package: e.package ?? `php${ver}-${e.id}`,
            installed: Boolean(e.installed) || optSet.has(e.id) }));
          defaults = r.defaults ?? [];
        } catch {
          const r = await systemApi.phpExtensions(ver, { bust });
          extensions = r.extensions.map((e) => ({
            ...e,
            installed: Boolean(e.installed) || optSet.has(e.id) }));
          defaults = r.defaults;
        }
        setExtCatalog(extensions);
        setExtDefaults(defaults);
        const installedIds = new Set(extensions.filter((e) => e.installed).map((e) => e.id));
        setExtSelected((prev) => {
          const ids = new Set(extensions.map((e) => e.id));
          // Never keep already-installed in install selection
          const kept = prev.filter((id) => ids.has(id) && !installedIds.has(id));
          if (kept.length) {
            for (const e of extensions) {
              if (e.required && !e.installed && !kept.includes(e.id)) kept.push(e.id);
            }
            return kept;
          }
          return defaults.filter(
            (id) => !installedIds.has(id) || extensions.find((e) => e.id === id)?.required,
          );
        });
      } catch {
        /* optional — install still works with server defaults */
      }
    },
    [],
  );

  useEffect(() => {
    void loadExtensions(version);
  }, [version, loadExtensions]);

  const extOptions: MultiCheckOption[] = useMemo(() => {
    // Only show not-yet-installed optional extensions for install selection
    return extCatalog
      .filter((e) => !e.required && !e.installed)
      .map((e) => ({
        value: e.id,
        label: `${e.label} (${e.package})`,
        hint: e.hint }));
  }, [extCatalog]);

  const installedOptionalExt = useMemo(
    () => extCatalog.filter((e) => e.installed && !e.required),
    [extCatalog],
  );

  const requiredExtLabels = useMemo(
    () =>
      extCatalog
        .filter((e) => e.required)
        .map((e) => `${e.label} (${e.package})${e.installed ? ' ✓' : ''}`)
        .join(' · '),
    [extCatalog],
  );

  const selectableExtIds = useMemo(
    () => extCatalog.filter((e) => !e.required && !e.installed).map((e) => e.id),
    [extCatalog],
  );

  const onExtChange = (next: string[]) => {
    const required = extCatalog.filter((e) => e.required).map((e) => e.id);
    const merged = [...new Set([...required, ...next.filter((id) => selectableExtIds.includes(id))])];
    setExtSelected(merged);
  };

  const loadIni = useCallback(async (ver: string) => {
    const r = await systemApi.phpIniGet(ver);
    setCatalog(r.catalog);
    setValues({ ...r.settings.values });
    const extraLines = Object.entries(r.settings.extra ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    setExtraText(extraLines);
    setRawAppend(r.settings.rawAppend ?? '');
    setManagedPath(r.managedIniPath);
    setIniUpdatedAt(r.settings.updatedAt);
    setIniLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab === 'ini') {
      void loadIni(version).catch((e) =>
        setError(e instanceof Error ? e.message : t('runtime.phpIniLoadFailed')),
      );
    }
  }, [tab, version, loadIni, setError]);

  const setValue = (key: string, v: string | number | boolean) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  const parseExtra = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of extraText.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith(';')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return out;
  };

  return (
    <FeaturePageLayout
      title={t('nav.php', { defaultValue: 'PHP' })}
      status={{
        pill: { label: `PHP ${version}`, tone: 'ok' },
        items: [
          { label: 'PHP', value: version },
          { label: 'Pool', value: poolName || '—' },
          {
            label: 'php.ini',
            value: iniLoaded ? (iniUpdatedAt ? t('runtime.loaded') : t('runtime.default')) : '—' },
        ] }}
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
      {error ? <Alert variant="error">{error}</Alert> : null}
      <PageTabs
        tabs={[
          { id: 'overview', label: t('runtime.overview') },
          { id: 'software', label: t('runtime.tabSoftware') },
          { id: 'ini', label: 'php.ini' },
          { id: 'site', label: t('runtime.fpmSites') },
          { id: 'tools', label: t('runtime.tools') },
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'overview' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={t('runtime.probeResult')}
                description={t('runtime.probeReadonly')}
              >
                <DescriptionList
                  columns={2}
                  items={[
                    {
                      label: t('runtime.hostDefault'),
                      value: hostPhp || '—',
                    },
                    {
                      label: t('runtime.phpVersion'),
                      value: version,
                    },
                    {
                      label: t('ssl.status.ready'),
                      value: phpInstallState.installedVersions.length
                        ? phpInstallState.installedVersions.join(', ')
                        : t('runtime.notDetectedYet'),
                    },
                  ]}
                />
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
                <ServiceLifecycleBar
                  matrixId="php-fpm"
                  unit="php8.2-fpm"
                  label="PHP-FPM"
                  actions={['start', 'stop', 'restart', 'reload']}
                  size="sm"
                  className="u-mt-3"
                />
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'software' ? (
          <>
            <RuntimeSoftwarePanel
              kind="php"
              title="PHP"
              bannerTitle={t('runtime.phpMissing')}
              version={version}
              onVersionChange={setVersion}
              supported={
                phpVersionOptions.length ? phpVersionOptions : version ? [version] : []
              }
              available={phpInstallState.installedVersions}
              hostRaw={hostPhp}
              hostDisplay={hostPhp || '—'}
              items={
                (
                  (probe?.probe as Record<string, unknown> | undefined)?.php as
                    | Array<Record<string, unknown>>
                    | undefined
                ) ?? []
              }
              multiVersion={false}
              panelDefault={panelDefault}
              busy={busy}
              showPlugins={false}
              installLabel={t('runtime.installPhpWithExt', {
                version,
                n: extSelected.filter((id) => selectableExtIds.includes(id)).length,
              })}
              onInstall={(v) => {
                const ver = v || version;
                if (v) setVersion(v);
                void run(async () => {
                  const optional = extSelected.filter((id) =>
                    selectableExtIds.includes(id),
                  );
                  const required = extCatalog.filter((e) => e.required).map((e) => e.id);
                  const started = stream?.begin({
                    kind: 'runtime',
                    title: t('runtime.installedPhp', { version: ver }),
                  });
                  const r = await systemApi.runtimeInstallStream(
                    {
                      kind: 'php',
                      version: ver,
                      install: true,
                      extensions: [
                        ...new Set([
                          ...required,
                          ...(optional.length ? optional : extDefaults),
                        ]),
                      ],
                    },
                    {
                      onLog: (line) => {
                        if (started && stream) stream.appendLog(started.id, line);
                      },
                      signal: started?.signal,
                    },
                  );
                  if (started && stream) {
                    stream.finish(started.id, {
                      ok: r.ok !== false && !r.blocked,
                      error: r.blockMessage,
                      toast: false,
                    });
                  }
                  await refresh();
                  await loadExtensions(ver, { bust: true });
                  return r as OpsResultLike;
                }, t('runtime.installedPhp', { version: ver }));
              }}
              onSetHostDefault={(v) => {
                setVersion(v);
                setHostDefaultConfirm(v);
              }}
              onSetPanelDefault={(v) =>
                void run(async () => {
                  await systemApi.setRuntimePanelDefault({ kind: 'php', version: v });
                  setPanelDefault(v);
                  return {
                    ok: true,
                    notes: [t('runtime.panelDefaultSaved', { version: v })],
                  } as OpsResultLike;
                }, t('runtime.panelDefaultSaved', { version: v }))
              }
              onUninstallVersion={(v) => {
                setUninstallTarget(v);
                setConfirmPhpUninstall(true);
              }}
              onReprobe={() => {
                setError(null);
                setMsg(null);
                void run(async () => {
                  await refresh();
                  return { ok: true, notes: [t('common.probed')] } as OpsResultLike;
                }, t('common.probed'));
              }}
              onStackLifecycleDone={() => void refresh()}
              detailExtra={
                <div className="u-mt-3">
                  {requiredExtLabels ? (
                    <p className="muted u-text-sm u-mb-2">
                      <strong>{t('runtime.phpExtRequired')}：</strong>
                      {requiredExtLabels}
                    </p>
                  ) : null}
                  {installedOptionalExt.length > 0 ? (
                    <div className="runtime-plugins__installed u-mb-3">
                      <Field
                        label={t('runtime.phpExtAlreadyOnHost')}
                        htmlFor="php-ext-installed"
                        flush
                        hint={t('runtime.phpExtUninstallHint')}
                      >
                        <ul className="runtime-plugins__list" id="php-ext-installed">
                          {installedOptionalExt.map((e) => (
                            <li key={e.id} className="runtime-plugins__row">
                              <div className="runtime-plugins__meta">
                                <span className="runtime-plugins__name">{e.label}</span>
                                <Badge tone="ok">
                                  {t('runtime.pluginStatusInstalled')}
                                </Badge>
                                <code className="runtime-plugins__hint muted u-text-sm">
                                  {e.package}
                                </code>
                              </div>
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={busy || extUninstallBusy}
                                loading={
                                  extUninstallBusy && confirmExtUninstall?.id === e.id
                                }
                                onClick={() => setConfirmExtUninstall(e)}
                              >
                                {t('runtime.pluginUninstall')}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </Field>
                    </div>
                  ) : null}
                  <Field
                    label={t('runtime.phpExtSelect')}
                    htmlFor="php-ext"
                    flush
                    hint={t('runtime.phpExtSelectHint', { version })}
                  >
                    <MultiCheckSelect
                      id="php-ext"
                      options={extOptions}
                      value={extSelected.filter((id) => selectableExtIds.includes(id))}
                      onChange={onExtChange}
                      searchPlaceholder={t('runtime.phpExtSearch')}
                      emptyText={t('runtime.phpExtEmpty')}
                      maxVisible={200}
                      showSelectAll
                      listSize="lg"
                      listMaxHeight="28rem"
                    />
                  </Field>
                  <FormActions>
                    {phpInstallState.selectedInstalled ? (
                      <Button
                        variant="secondary"
                        size="md"
                        disabled={
                          busy ||
                          extUninstallBusy ||
                          extSelected.filter((id) => selectableExtIds.includes(id))
                            .length === 0
                        }
                        loading={busy}
                        onClick={() => {
                          const optional = extSelected.filter((id) =>
                            selectableExtIds.includes(id),
                          );
                          void run(async () => {
                            const required = extCatalog
                              .filter((e) => e.required)
                              .map((e) => e.id);
                            const started = stream?.begin({
                              kind: 'runtime',
                              title: t('runtime.phpExtInstallSelected', { n: optional.length }),
                            });
                            const r = await systemApi.runtimeInstallStream(
                              {
                                kind: 'php',
                                version,
                                install: true,
                                extensions: [...new Set([...required, ...optional])],
                              },
                              {
                                onLog: (line) => {
                                  if (started && stream) stream.appendLog(started.id, line);
                                },
                                signal: started?.signal,
                              },
                            );
                            if (started && stream) {
                              stream.finish(started.id, {
                                ok: r.ok !== false && !r.blocked,
                                error: r.blockMessage,
                                toast: false,
                              });
                            }
                            await refresh();
                            await loadExtensions(version, {
                              bust: true,
                              optimisticInstalled: optional,
                            });
                            return r as OpsResultLike;
                          }, t('runtime.phpExtInstallSelected', { n: optional.length }));
                        }}
                      >
                        {t('runtime.phpExtInstallSelected', {
                          n: extSelected.filter((id) => selectableExtIds.includes(id))
                            .length,
                        })}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="md"
                      disabled={busy || !extDefaults.length}
                      onClick={() => setExtSelected([...extDefaults])}
                    >
                      {t('runtime.phpExtRecommended')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="md"
                      disabled={busy || !selectableExtIds.length}
                      onClick={() => {
                        const required = extCatalog
                          .filter((e) => e.required)
                          .map((e) => e.id);
                        setExtSelected([...new Set([...required, ...selectableExtIds])]);
                      }}
                    >
                      {t('runtime.phpExtSelectAll')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="md"
                      disabled={busy}
                      onClick={() =>
                        setExtSelected(
                          extCatalog.filter((e) => e.required).map((e) => e.id),
                        )
                      }
                    >
                      {t('runtime.phpExtCoreOnly')}
                    </Button>
                  </FormActions>
                  <FormHint>
                    {phpInstallState.selectedInstalled
                      ? t('runtime.phpExtInstallNoteInstalled')
                      : t('runtime.phpExtInstallNoteFirst', { version })}
                  </FormHint>
                  {extOps ? (
                    <div className="u-mt-3">
                      <OpsResultPanel title={t('runtime.phpExtOpsTitle')} result={extOps} />
                    </div>
                  ) : null}
                </div>
              }
            />
            <ConfirmDialog
              open={confirmPhpUninstall}
              title={t('runtime.uninstallVersionTitle', {
                version: uninstallTarget || version,
              })}
              description={t('runtime.uninstallVersionConfirm', {
                version: uninstallTarget || version,
                name: 'PHP',
              })}
              confirmLabel={t('runtime.uninstallVersion', {
                version: uninstallTarget || version,
              })}
              cancelLabel={t('common.cancel')}
              severity="destructive"
              danger
              busy={busy}
              onClose={() => {
                setConfirmPhpUninstall(false);
                setUninstallTarget(null);
              }}
              onConfirm={() => {
                const ver = uninstallTarget || version;
                setConfirmPhpUninstall(false);
                setUninstallTarget(null);
                void run(async () => {
                  const r = await systemApi.runtimeUninstall({
                    kind: 'php',
                    version: ver,
                  });
                  await refresh();
                  await loadExtensions(ver, { bust: true }).catch(() => undefined);
                  return r as OpsResultLike;
                }, t('runtime.uninstallVersionDone', { version: ver }));
              }}
            />
            <ConfirmDialog
              open={Boolean(hostDefaultConfirm)}
              title={t('runtime.setHostDefaultConfirmTitle', {
                version: hostDefaultConfirm || version,
              })}
              description={t('runtime.setHostDefaultConfirm', {
                version: hostDefaultConfirm || version,
              })}
              confirmLabel={t('runtime.setHostDefault')}
              cancelLabel={t('common.cancel')}
              busy={busy}
              onClose={() => setHostDefaultConfirm(null)}
              onConfirm={() => {
                const ver = hostDefaultConfirm || version;
                setHostDefaultConfirm(null);
                void run(async () => {
                  const r = await systemApi.runtimeSwitch({ kind: 'php', version: ver });
                  await refresh();
                  return r as OpsResultLike;
                }, t('runtime.switchDefaultBtn', { version: ver }));
              }}
            />
            <ConfirmDialog
              open={Boolean(confirmExtUninstall)}
              title={t('runtime.phpExtUninstallConfirmTitle')}
              description={
                confirmExtUninstall
                  ? t('runtime.phpExtUninstallConfirm', {
                      name: confirmExtUninstall.label,
                      pkg: confirmExtUninstall.package,
                    })
                  : ''
              }
              confirmLabel={t('runtime.pluginUninstall')}
              cancelLabel={t('common.cancel')}
              danger
              busy={extUninstallBusy}
              onConfirm={() => {
                if (!confirmExtUninstall) return;
                const row = confirmExtUninstall;
                setExtUninstallBusy(true);
                void systemApi
                  .phpExtensionsUninstall({
                    version,
                    extensions: [row.id],
                  })
                  .then((r) => {
                    const body = r as {
                      ok?: boolean;
                      notes?: string[];
                      blocked?: boolean;
                      blockMessage?: string;
                    };
                    setExtOps({
                      ok: body.ok !== false && !body.blocked,
                      notes: body.notes,
                      blocked: body.blocked,
                      blockMessage: body.blockMessage,
                    });
                    if (body.blocked) {
                      toast.warn(
                        body.blockMessage ??
                          body.notes?.[0] ??
                          t('runtime.pluginUninstallBlocked'),
                      );
                    } else if (body.ok === false) {
                      toast.error(
                        body.notes?.[0] ??
                          t('runtime.pluginUninstallFailed', { name: row.label }),
                      );
                    } else {
                      toast.ok(t('runtime.pluginUninstalled', { name: row.label }));
                    }
                    if (body.ok !== false && !body.blocked) {
                      setExtCatalog((prev) =>
                        prev.map((e) =>
                          e.id === row.id ? { ...e, installed: false } : e,
                        ),
                      );
                    }
                    return loadExtensions(version, { bust: true });
                  })
                  .catch((e: Error) => {
                    toast.error(e.message);
                    setExtOps({ ok: false, notes: [e.message] });
                  })
                  .finally(() => {
                    setExtUninstallBusy(false);
                    setConfirmExtUninstall(null);
                  });
              }}
              onClose={() => {
                if (!extUninstallBusy) setConfirmExtUninstall(null);
              }}
            />
          </>
        ) : null}

        {tab === 'ini' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={t('runtime.globalPhpIni')}
                description={t('runtime.globalPhpIniDesc')}
              >
                <FormLayout columns={2}>
                  <Field label={t('runtime.phpVersion')} htmlFor="ini-ver" flush required>
                    {phpVersionOptions.length <= 8 ? (
                      <SegRadio
                        name="ini-ver"
                        aria-label={t('runtime.phpVersion')}
                        value={version}
                        onChange={setVersion}
                        options={phpVersionOptions.map((v) => ({
                          value: v,
                          label: v }))}
                      />
                    ) : (
                      <select
                        id="ini-ver"
                        value={version}
                        onChange={bindInput(setVersion)}
                      >
                        {phpVersionOptions.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label={t('runtime.managePath')} htmlFor="ini-path" flush>
                    <input id="ini-path" value={managedPath || '—'} readOnly spellCheck={false} />
                  </Field>
                </FormLayout>
                <FormHint>
                  {t('runtime.phpIniNote')}
                </FormHint>
              </CardSection>
            </Card>

            {!iniLoaded && !error ? (
              <Card>
                <CardSection title={t('runtime.loading')}>
                  <p className="muted">{t('runtime.phpIniLoading')}</p>
                </CardSection>
              </Card>
            ) : null}

            {iniLoaded && catalog.length === 0 ? (
              <Card>
                <CardSection title={t('runtime.cannotLoadSettings')}>
                  <p className="muted">{t('runtime.phpIniEmpty')}</p>
                  <FormActions>
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() =>
                        void loadIni(version).catch((e) =>
                          setError(e instanceof Error ? e.message : t('runtime.reloadFailed')),
                        )
                      }
                    >
                      {t('runtime.reloadForm')}
                    </Button>
                  </FormActions>
                </CardSection>
              </Card>
            ) : null}

            {catalog.map((group) => (
              <Card key={group.id}>
                <CardSection title={group.title} description={group.description}>
                  {/* 一行一個表單欄位：標籤在上、控制項在下 */}
                  <FormLayout columns={1}>
                    {group.fields.map((f) => {
                      const id = `ini-${f.key}`;
                      const val = values[f.key] ?? f.default;
                      const hintParts = [
                        f.hint,
                        f.danger ? t('runtime.sensitive') : undefined,
                      ].filter(Boolean);
                      return (
                        <Field
                          key={f.key}
                          label={f.label}
                          htmlFor={id}
                          techKey={f.key}
                          hint={hintParts.join(' · ') || undefined}
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
                                  {!cur ? (
                                    <option value="">{/* empty */}</option>
                                  ) : null}
                                  {merged.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              );
                            })()
                          ) : f.type === 'multiselect' && f.options ? (
                            (() => {
                              const raw = String(val ?? '');
                              const selected = raw
                                .split(/[\s,]+/)
                                .map((s) => s.trim())
                                .filter(Boolean);
                              const known = new Set(f.options!.map((o) => o.value));
                              const extras = selected.filter((s) => !known.has(s));
                              const opts = [
                                ...f.options!.map((o) => ({
                                  value: o.value,
                                  label: o.label || o.value,
                                  hint: o.group
                                    ? t(`runtime.phpIniCatalog.disableFn.groups.${o.group}`, {
                                        defaultValue: o.group })
                                    : undefined })),
                                ...extras.map((v) => ({
                                  value: v,
                                  label: v,
                                  hint: t('runtime.phpIniCatalog.disableFn.extraHint') })),
                              ];
                              return (
                                <MultiCheckSelect
                                  id={id}
                                  options={opts}
                                  value={selected}
                                  onChange={(next) => setValue(f.key, next.join(','))}
                                  allowCustom={f.key === 'disable_functions'}
                                  customCase="lower"
                                  customPlaceholder={t(
                                    'runtime.phpIniCatalog.disableFn.customPlaceholder',
                                  )}
                                  searchPlaceholder={t(
                                    'runtime.phpIniCatalog.disableFn.searchPlaceholder',
                                  )}
                                  emptyText={t('runtime.phpIniCatalog.disableFn.emptyText')}
                                />
                              );
                            })()
                          ) : f.type === 'textarea' ? (
                            <textarea
                              id={id}
                              rows={3}
                              value={String(val ?? '')}
                              onChange={(e) => setValue(f.key, e.target.value)}
                              spellCheck={false}
                            />
                          ) : f.type === 'int' ? (
                            <PresetChips
                              options={phpIniPresets(f.key, 'int')}
                              value={String(val ?? f.default ?? '')}
                              onChange={(v) => setValue(f.key, Number(v))}
                              allowCustom
                              customPlaceholder={t('runtime.customNumber')}
                            />
                          ) : f.type === 'bytes' ? (
                            <PresetChips
                              options={phpIniPresets(f.key, 'bytes')}
                              value={String(val ?? f.default ?? '')}
                              onChange={(v) => setValue(f.key, v)}
                              allowCustom
                              customPlaceholder={t('runtime.customExample')}
                            />
                          ) : (
                            <input
                              id={id}
                              value={String(val ?? '')}
                              onChange={(e) => setValue(f.key, e.target.value)}
                              spellCheck={false}
                              placeholder={String(f.default ?? '')}
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
              <CardSection
                title={t('runtime.advancedExtra')}
                description={t('runtime.advancedExtraDesc')}
              >
                <FormLayout columns={1}>
                  <Field
                    label={t('runtime.extraDirectives')}
                    htmlFor="ini-extra"
                    techKey="extra"
                    hint={t('runtime.extraDirectivesHint')}
                    flush
                    fullWidth
                  >
                    <textarea
                      id="ini-extra"
                      rows={4}
                      value={extraText}
                      onChange={bindInput(setExtraText)}
                      placeholder="variables_order=GPCS"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    label="Raw append"
                    htmlFor="ini-raw"
                    techKey="rawAppend"
                    hint={t('runtime.rawAppend')}
                    flush
                    fullWidth
                  >
                    <textarea
                      id="ini-raw"
                      rows={4}
                      value={rawAppend}
                      onChange={bindInput(setRawAppend)}
                      placeholder="; custom block"
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
              </CardSection>
            </Card>

            <FormActions>
              <Button
                variant="primary"
                size="md"
                loading={busy}
                disabled={!iniLoaded && catalog.length === 0}
                onClick={() =>
                  void run(async () => {
                    const r = await systemApi.phpIniSave({
                      version,
                      values,
                      extra: parseExtra(),
                      rawAppend });
                    await loadIni(version);
                    return r as OpsResultLike;
                  }, t('runtime.phpIniSaved'))
                }
              >
                {t('runtime.savePhpIni')}
              </Button>
              <Button
                variant="secondary"
                size="md"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    await systemApi.phpIniSave({
                      version,
                      values,
                      extra: parseExtra(),
                      rawAppend });
                    return (await systemApi.phpIniApply(version)) as OpsResultLike;
                  }, t('runtime.appliedSystem'))
                }
              >
                {t('firewall.applyToSystem')}
              </Button>
              <Button
                variant="ghost"
                size="md"
                loading={busy}
                onClick={() => {
                  setError(null);
                  void loadIni(version).catch((e) =>
                    setError(e instanceof Error ? e.message : t('runtime.reloadFailed')),
                  );
                }}
              >
                {t('updates.reload')}
              </Button>
            </FormActions>
          </div>
        ) : null}

        {tab === 'site' ? (
          <div className="tab-panel">
            <Alert variant="info">
              <strong>{t('runtime.prodUseProjects')}</strong>
              {t('runtime.prodPathDesc')}{' '}
              <strong>{t('runtime.systemDemo')}</strong>
              {t('runtime.demoNotBind')}
            </Alert>
            <Card>
              <CardSection
                title={t('runtime.demoVhost')}
                description={t('runtime.demoVhostDesc')}
              >
                <FormLayout columns={2}>
                  <Field label={t('runtime.domain')} htmlFor="php-dom" flush required hint={t('runtime.vhostServerName')}>
                    <input
                      id="php-dom"
                      value={domain}
                      onChange={(e) => {
                        setDomain(e.target.value);
                        setServerContext({ domain: e.target.value.replace(/^php\./, '') });
                      }}
                      placeholder="php.demo.local"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    label={t('runtime.poolName')}
                    htmlFor="php-pool"
                    flush
                    required
                    hint={t('runtime.poolNameHint')}
                  >
                    <input
                      id="php-pool"
                      value={poolName}
                      onChange={bindInput(setPoolName)}
                      placeholder="demo"
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
                <div className="form-check-row u-mt-4">
                  <CheckboxField
                    id="php-en"
                    label={t('runtime.enableReload')}
                    description={t('runtime.enableReloadHint')}
                    checked={enableSite}
                    onChange={setEnableSite}
                  />
                </div>
                <FormHint>
                  {t('runtime.applyOkWritten')}
                </FormHint>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        try {
                          return (await systemApi.phpApply({
                            domain,
                            poolName,
                            enableSite })) as OpsResultLike;
                        } catch (e) {
                          const m = e instanceof Error ? e.message : t('common.applyFailed');
                          return { ok: false, blocked: true, blockMessage: m, notes: [m] };
                        }
                      }, t('runtime.phpVhostApplied'))
                    }
                  >
                    {t('runtime.applyPhpVhost')}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'tools' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={t('runtime.composerTools')}
                description={t('runtime.composerToolsDesc')}
              >
                <FormActions>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        const probe = await api.requestRaw<ToolsProbe>('/api/v1/runtimes/tools');
                        setTools(probe);
                        return {
                          ok: true,
                          notes: probe.notes ?? [t('runtime.toolsProbed')] } as OpsResultLike;
                      }, t('runtime.toolsProbed'))
                    }
                  >
                    {t('runtime.reprobeTools')}
                  </Button>
                </FormActions>
                {tools ? (
                  <>
                    <DescriptionList
                      columns={2}
                      items={[
                        { label: 'PHP', value: tools.php?.version ?? t('runtime.notFound') },
                        {
                          label: 'Composer',
                          value: tools.composer?.available ? (
                            <Badge tone="ok">{tools.composer.version ?? t('common.available')}</Badge>
                          ) : (
                            <Badge tone="warn">{t('network.unavailable')}</Badge>
                          ) },
                        {
                          label: 'WP-CLI',
                          value: tools.wpCli?.available ? (
                            <Badge tone="ok">{tools.wpCli.version ?? t('common.available')}</Badge>
                          ) : (
                            <Badge tone="warn">{t('network.unavailable')}</Badge>
                          ) },
                        {
                          label: t('runtime.moduleCount'),
                          value: String(tools.php?.modules?.length ?? 0) },
                      ]}
                    />
                    {tools.php?.modules?.length ? (
                      <p className="muted u-text-sm u-mt-3 u-break-all">
                        {tools.php.modules.slice(0, 40).join(', ')}
                        {tools.php.modules.length > 40 ? '…' : ''}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="muted">{t('runtime.pressReprobeLoad')}</p>
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="php" /> : null}
      </PageTabs>

      <OpsResultPanel title={t('systemd.opsResult')} result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
