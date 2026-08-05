/**
 * PHP runtime — Overview · php.ini · FPM/站點 · 工具
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../shared/lib/i18n';
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
  MultiCheckSelect,
  OpsResultPanel,
  PresetChips,
  SegRadio,
  SoftwareInstallBanner,
  PageTabs,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { getServerContext, setServerContext } from '../../shared/stores/server-context';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { api } from '../../shared/services/api';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { bindSet, bindInput } from '../bind-handlers';

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
    options?: Array<{ value: string; label: string }>;
  }>;
};

const PHP_TABS = ['overview', 'ini', 'site', 'tools', 'about'] as const;

export function PhpRuntimePage() {
  const { t } = useTranslation();
  const ctx = getServerContext();
  const [tab, setTab] = usePageTab(PHP_TABS, 'overview');
  const [domain, setDomain] = useState(`php.${ctx.domain}`);
  const [poolName, setPoolName] = useState('demo');
  const [version, setVersion] = useState('8.2');
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
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    try {
      setProbe((await systemApi.runtimes()) as Record<string, unknown>);
    } catch {
      /* optional */
    }
    try {
      setTools(await api.requestRaw<ToolsProbe>('/api/v1/runtimes/tools'));
    } catch {
      /* optional */
    }
  }, []);

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
            value: iniLoaded ? (iniUpdatedAt ? t('runtime.loaded') : t('runtime.default')) : '—',
          },
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
      <SoftwareInstallBanner feature="php" title={t('runtime.phpMissing')} />
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={bindSet(setMsg, null)}>
            {t('common.close')}
          </Button>
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          { id: 'overview', label: t('runtime.overview') },
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
              <CardSection title={t('runtime.installPhp')} description={t('runtime.phpInstallHint')}>
                <FormLayout columns={2}>
                  <Field label={t('runtime.phpVersion')} htmlFor="php-ver" flush required>
                    <SegRadio
                      name="php-ver"
                      aria-label={t('runtime.phpVersion')}
                      value={version}
                      onChange={setVersion}
                      options={[
                        { value: '8.1', label: '8.1' },
                        { value: '8.2', label: '8.2' },
                        { value: '8.3', label: '8.3' },
                      ]}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await systemApi.runtimeInstall({
                          kind: 'php',
                          version,
                          install: true,
                        });
                        await refresh();
                        return r as OpsResultLike;
                      }, t('runtime.installedPhp', { version }))
                    }
                  >
                    {t('runtime.installPhpVBtn', { version })}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>

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
                </CardSection>
              </Card>
            ) : null}

            <Card>
              <CardSection title={t('security.ssh.nextStep')} description={t('runtime.suggestedFlow')}>
                <ol className="list-plain list-spaced">
                  <li>
                    {t('runtime.phpIniSteps1')}
                  </li>
                  <li>
                    {t('runtime.phpIniSteps2')}
                  </li>
                  <li>
                    {t('runtime.phpIniSteps3')}
                  </li>
                  <li>{t('runtime.phpIniSteps4')}</li>
                </ol>
              </CardSection>
            </Card>
          </div>
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
                    <SegRadio
                      name="ini-ver"
                      aria-label={t('runtime.phpVersion')}
                      value={version}
                      onChange={setVersion}
                      options={[
                        { value: '8.1', label: '8.1' },
                        { value: '8.2', label: '8.2' },
                        { value: '8.3', label: '8.3' },
                      ]}
                    />
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
                                        defaultValue: o.group,
                                      })
                                    : undefined,
                                })),
                                ...extras.map((v) => ({
                                  value: v,
                                  label: v,
                                  hint: t('runtime.phpIniCatalog.disableFn.extraHint'),
                                })),
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
                      rawAppend,
                    });
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
                      rawAppend,
                    });
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
                            enableSite,
                          })) as OpsResultLike;
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
                          notes: probe.notes ?? [t('runtime.toolsProbed')],
                        } as OpsResultLike;
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
                          ),
                        },
                        {
                          label: 'WP-CLI',
                          value: tools.wpCli?.available ? (
                            <Badge tone="ok">{tools.wpCli.version ?? t('common.available')}</Badge>
                          ) : (
                            <Badge tone="warn">{t('network.unavailable')}</Badge>
                          ),
                        },
                        {
                          label: t('runtime.moduleCount'),
                          value: String(tools.php?.modules?.length ?? 0),
                        },
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
