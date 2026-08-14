/**
 * Multi-category DB service console.
 * Overview = DescriptionList (never inputs). Settings = Form Kit (max 2 cols).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  OpsResultPanel,
  PresetChips,
  SegRadio,
  PageTabs,
  FeaturePageLayout,
  SoftwareInstallBanner,
  SoftwareVersionBar,
  ConfirmDialog } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import type { DbServiceEngine } from '../../features/db-service';
import {
  consoleApi,
  type ConsoleCategory,
  type ConsoleSetting,
  type ServiceConsole } from '../../features/db-service/console-api';
import { DbClusterPanel } from '../../features/db-service/DbClusterPanel';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import {
  ServiceAccessStrip,
  ServiceExposureDialog,
  usePrivateStartGate,
} from '../../features/network/service-exposure';
import { useTranslation } from 'react-i18next';
import i18n from '../../shared/lib/i18n';
import { bindSet, bindVoid, bindCall1 } from '../bind-handlers';

/** Console engine → exposure service id */
function exposureServiceId(engine: DbServiceEngine): string {
  if (engine === 'postgres') return 'postgresql';
  return engine;
}

function defaultPortForEngine(engine: DbServiceEngine): string {
  if (engine === 'postgres') return '5432';
  if (engine === 'redis') return '6379';
  return '3306';
}

function consolePresets(
  engine: DbServiceEngine,
  key: string,
  type: string,
): Array<{ value: string; label: string }> {
  if (/port/i.test(key)) {
    const p = defaultPortForEngine(engine);
    return [{ value: p, label: p }];
  }
  if (/expire_logs_days|expire_logs/i.test(key) && /second/i.test(key) === false && !/sec/i.test(key)) {
    return [
      { value: '1', label: '1d' },
      { value: '7', label: '7d' },
      { value: '14', label: '14d' },
      { value: '30', label: '30d' },
    ];
  }
  if (/expire_logs_seconds|binlog_expire_logs_seconds/i.test(key)) {
    return [
      { value: '86400', label: '1d' },
      { value: '604800', label: '7d' },
      { value: '1209600', label: '14d' },
      { value: '2592000', label: '30d' },
    ];
  }
  if (/shared_buffers|work_mem|maintenance_work_mem|innodb_buffer/i.test(key)) {
    return [
      { value: '128MB', label: '128MB' },
      { value: '256MB', label: '256MB' },
      { value: '512MB', label: '512MB' },
      { value: '1GB', label: '1GB' },
    ];
  }
  if (/max_wal_size|min_wal_size/i.test(key)) {
    return [
      { value: '64MB', label: '64MB' },
      { value: '256MB', label: '256MB' },
      { value: '1GB', label: '1GB' },
    ];
  }
  if (/log_min_duration/i.test(key)) {
    return [
      { value: '-1', label: 'off' },
      { value: '0', label: 'all' },
      { value: '200', label: '200ms' },
      { value: '1000', label: '1s' },
    ];
  }
  if (type === 'duration' || /timeout|idle|query_time/i.test(key)) {
    return [
      { value: '30', label: '30s' },
      { value: '60', label: '60s' },
      { value: '300', label: '5m' },
      { value: '600', label: '10m' },
    ];
  }
  if (/conn|client|worker|pool/i.test(key)) {
    return [
      { value: '50', label: '50' },
      { value: '100', label: '100' },
      { value: '200', label: '200' },
      { value: '500', label: '500' },
    ];
  }
  return [];
}

const DATA_LINK: Record<DbServiceEngine, { path: string; label: string }> = {
  redis: { path: '/databases/redis', label: i18n.t('db.console.dataBrowse') },
  mysql: { path: '/databases/mysql', label: i18n.t('db.console.dbManage') },
  mariadb: { path: '/databases/mariadb', label: i18n.t('db.console.dbManage') },
  postgres: { path: '/databases/postgres', label: i18n.t('db.console.dbManage') } };

export function applyModeLabel(m: string): string {
  if (m === 'runtime') return i18n.t('db.console.realtime');
  if (m === 'reload') return i18n.t('services.action.reload');
  if (m === 'restart') return i18n.t('db.console.needRestart');
  return m;
}

export function displayValue(v?: string): string {
  if (v == null || v === '') return '';
  return v;
}

/** Collect dirty setting keys vs live values. */
export function collectDirtyKeys(
  categories: Array<{
    settings: Array<{ key: string; liveValue?: string }>;
  }> | null | undefined,
  draft: Record<string, string>,
): string[] {
  if (!categories) return [];
  const out: string[] = [];
  for (const cat of categories) {
    for (const s of cat.settings) {
      const live = displayValue(s.liveValue);
      const cur = draft[s.key] ?? live;
      if (cur !== live) out.push(s.key);
    }
  }
  return out;
}

/** Seed draft map from console categories. */
export function seedDraftFromConsole(
  categories: Array<{
    settings: Array<{ key: string; liveValue?: string }>;
  }> | null | undefined,
): Record<string, string> {
  const d: Record<string, string> = {};
  if (!categories) return d;
  for (const cat of categories) {
    for (const s of cat.settings) {
      d[s.key] = displayValue(s.liveValue);
    }
  }
  return d;
}

/** Lifecycle action success i18n-ish key. */
export function lifecycleActionKey(action: string): string {
  if (action === 'start') return 'services.action.start';
  if (action === 'stop') return 'services.action.stop';
  if (action === 'restart') return 'services.action.restart';
  if (action === 'reload') return 'services.action.reload';
  return action;
}

/** Whether a setting is a number type for presets. */
export function isNumberSetting(s: { type?: string; kind?: string }): boolean {
  return s.type === 'number' || s.kind === 'number' || s.type === 'int';
}

/** Apply a numeric preset (min/mid/max) from catalog bounds. */
export function applyNumberPreset(
  current: string,
  preset: 'min' | 'mid' | 'max',
  bounds: { min?: number; max?: number; default?: number },
): string {
  const min = bounds.min ?? 0;
  const max = bounds.max ?? 100;
  if (preset === 'min') return String(min);
  if (preset === 'max') return String(max);
  if (bounds.default != null) return String(bounds.default);
  return String(Math.round((min + max) / 2));
}

/** Enum option is currently selected. */
export function isEnumSelected(current: string, option: string): boolean {
  return current === option;
}

export function ServiceConsolePage({ engine }: { engine: DbServiceEngine }) {
  const { t } = useTranslation();
  const [console, setConsole] = useState<ServiceConsole | null>(null);
  const [tab, setTab] = useState('lifecycle');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingLc, setPendingLc] = useState<'stop' | 'restart' | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();
  const link = DATA_LINK[engine];
  const svcId = exposureServiceId(engine);
  const startGate = usePrivateStartGate(svcId);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const c = await consoleApi.get(engine);
      setConsole(c);
      const d: Record<string, string> = {};
      for (const cat of c.categories) {
        for (const s of cat.settings) {
          d[s.key] = displayValue(s.liveValue);
        }
      }
      setDraft(d);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dirtyKeys = useMemo(
    () => collectDirtyKeys(console?.categories, draft),
    [console, draft],
  );

  const tabs = useMemo(() => {
    const base = [
      { id: 'lifecycle', label: t('common.lifecycle') },
      { id: 'overview', label: t('publicFiles.overview') },
      { id: 'cluster', label: t('dns.tabs.cluster') },
    ];
    const stack = { id: 'stack', label: t('tabs.stack') };
    const about = { id: 'about', label: t('common.about') };
    if (!console) return [...base, stack, about];
    return [
      ...base,
      ...console.categories.map((c) => ({ id: c.id, label: c.label })),
      stack,
      about,
    ];
  }, [console]);

  async function doLifecycle(
    action: string,
    exposure?: {
      exposureDecision?: 'keep-private' | 'public' | 'restricted';
      allowFrom?: string[];
    },
  ) {
    if (action === 'start' || action === 'restart') {
      if (!exposure?.exposureDecision) {
        const gate = await startGate.prepareStart();
        if (!gate.proceed) return;
      }
    }
    await run(async () => {
      try {
        const r = await consoleApi.lifecycle(engine, action, exposure);
        await refresh();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.opFailed');
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, t('db.console.actionDone', { action }));
  }

  async function doInstall() {
    await run(async () => {
      try {
        const r = await consoleApi.install(engine);
        await refresh();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.installFailed');
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, t('db.console.installDone'));
  }

  async function doApply(keys?: string[]) {
    const changes: Record<string, string> = {};
    const list = keys ?? dirtyKeys;
    for (const k of list) {
      if (draft[k] != null) changes[k] = draft[k];
    }
    if (!Object.keys(changes).length) {
      setError(t('db.console.noChanges'));
      return;
    }
    await run(async () => {
      try {
        const r = await consoleApi.apply(engine, changes);
        await refresh();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.applyFailed');
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, t('db.console.settingsApplied'));
  }

  function renderControl(s: ConsoleSetting) {
    const val = draft[s.key] ?? displayValue(s.liveValue);
    const onChange = (v: string) => setDraft((d) => ({ ...d, [s.key]: v }));
    const id = `sc-${engine}-${s.key}`;

    if (
      s.type === 'bool' ||
      (s.enumValues &&
        s.enumValues.length <= 6 &&
        (s.enumValues.includes('ON') ||
          s.enumValues.includes('OFF') ||
          s.enumValues.includes('yes') ||
          s.enumValues.includes('no')))
    ) {
      const opts = s.enumValues ?? ['ON', 'OFF'];
      const current = opts.includes(val) ? val : opts[0]!;
      return (
        <SegRadio
          name={id}
          aria-label={s.label}
          value={current}
          onChange={onChange}
          options={opts.map((x) => ({ value: x, label: x }))}
        />
      );
    }
    if (s.enumValues?.length) {
      const enums =
        val && !s.enumValues.includes(val) ? [val, ...s.enumValues] : s.enumValues;
      if (enums.length <= 12) {
        const current = enums.includes(val) ? val : enums[0]!;
        return (
          <SegRadio
            name={id}
            aria-label={s.label}
            value={current}
            onChange={onChange}
            options={enums.map((x) => ({ value: x, label: x }))}
          />
        );
      }
      return (
        <select id={id} value={val} onChange={(e) => onChange(e.target.value)} aria-label={s.label}>
          {val === '' ? <option value="">{t('db.console.noneFetched')}</option> : null}
          {enums.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      );
    }
    if (
      s.type === 'int' ||
      s.type === 'number' ||
      s.type === 'duration' ||
      /port|timeout|conn|size|memory|buffer|worker|pool/i.test(s.key)
    ) {
      const numish = val === '' || /^-?\d+(\.\d+)?[smh]?$/.test(val.trim());
      if (numish || s.type === 'duration') {
        const presets = consolePresets(engine, s.key, s.type);
        return (
          <PresetChips
            options={presets}
            value={val}
            onChange={onChange}
            allowCustom
            customPlaceholder={t('common.custom')}
          />
        );
      }
    }
    // Secrets stay free-text password fields
    if (s.danger && /pass|password|secret|requirepass/i.test(s.key)) {
      return (
        <input
          id={id}
          type="password"
          autoComplete="new-password"
          value={val}
          onChange={(e) => onChange(e.target.value)}
          placeholder={s.liveValue == null ? t('db.console.notReadFromService') : undefined}
          aria-label={s.label}
        />
      );
    }
    return (
      <input
        id={id}
        value={val}
        onChange={(e) => onChange(e.target.value)}
        placeholder={s.liveValue == null ? t('db.console.notReadFromService') : undefined}
        aria-label={s.label}
      />
    );
  }

  function renderSetting(s: ConsoleSetting) {
    const live = displayValue(s.liveValue);
    const dirty = (draft[s.key] ?? live) !== live;
    const mode = applyModeLabel(s.applyMode);
    const hintParts = [
      s.description,
      mode ? t('db.console.applyMode', { mode }) : null,
      dirty ? t('db.console.dirtyNotApplied') : null,
      s.danger ? t('db.console.highRisk') : null,
    ].filter(Boolean);
    return (
      <div key={s.key} className={dirty ? 'field-wrap is-dirty' : 'field-wrap'}>
        <Field
          label={s.label}
          techKey={s.key}
          htmlFor={`sc-${engine}-${s.key}`}
          flush
          hint={hintParts.length ? hintParts.join(' · ') : undefined}
        >
          {renderControl(s)}
        </Field>
      </div>
    );
  }

  function categoryBody(cat: ConsoleCategory) {
    const rows = cat.settings.filter((s) => !s.advanced || tab === 'advanced');
    if (!rows.length) {
      return <p className="muted">{t('db.console.noSettings')}</p>;
    }
    const catDirty = dirtyKeys.filter((k) => rows.some((r) => r.key === k));
    return (
      <>
        {cat.description ? <FormHint>{cat.description}</FormHint> : null}
        <FormHint>
          {t('db.console.applyHint')}
        </FormHint>
        <FormLayout columns={2}>{rows.map(renderSetting)}</FormLayout>
        <FormActions>
          <Button
            variant="primary"
            size="md"
            loading={busy}
            disabled={!catDirty.length}
            onClick={bindCall1(doApply, catDirty)}
          >
            {catDirty.length ? t('db.console.applyCatCount', { n: catDirty.length }) : t('db.console.applyCategory')}
          </Button>
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            disabled={!dirtyKeys.length}
            onClick={bindVoid(doApply)}
          >
            {dirtyKeys.length ? t('db.console.applyAllCount', { n: dirtyKeys.length }) : t('db.console.applyAll')}
          </Button>
        </FormActions>
      </>
    );
  }

  const overviewItems = useMemo(() => {
    if (!console) return [];
    return [
      { label: t('db.console.engine'), value: console.title },
      {
        label: t('common.status'),
        value: (
          <Badge tone={console.active === 'active' ? 'ok' : 'warn'}>{console.activeLabel}</Badge>
        ) },
      { label: 'systemd', value: console.unit },
      { label: t('systemd.bootEnabled'), value: console.enabled ?? '—' },
      { label: t('common.version'), value: console.version ?? '—' },
      {
        label: t('db.systemChange'),
        value: console.executeEnabled ? t('db.opened') : t('db.notOpened') },
      { label: t('roles.admin'), value: console.isRoot ? t('common.yes') : t('common.no') },
      ...(console.metrics.Uptime
        ? [{ label: t('db.console.uptimeSec'), value: console.metrics.Uptime }]
        : []),
      ...(console.metrics.Threads_connected
        ? [{ label: t('db.console.currentConnections'), value: console.metrics.Threads_connected }]
        : []),
      ...(console.metrics.used_memory
        ? [{ label: t('common.memory'), value: console.metrics.used_memory }]
        : []),
      ...(console.metrics.connected_clients
        ? [{ label: t('db.client'), value: console.metrics.connected_clients }]
        : []),
    ];
  }, [console]);

  return (
    <FeaturePageLayout
      title={t('db.console.serviceTitle', { title: console?.title ?? engine })}
      status={
        console
          ? {
              pill: {
                label: console.activeLabel,
                tone:
                  console.active === 'active'
                    ? 'ok'
                    : console.installed
                      ? 'warn'
                      : 'danger' },
              items: [
                {
                  label: t('common.status'),
                  value: console.activeLabel,
                  tone:
                    console.active === 'active'
                      ? 'ok'
                      : console.installed
                        ? 'warn'
                        : 'danger' },
                {
                  label: t('common.version'),
                  value:
                    console.version?.replace(/^mysql\s+Ver\s+/i, '').slice(0, 28) ??
                    '—' },
                {
                  label: 'EXECUTE',
                  value: console.executeEnabled ? t('common.on') : t('common.off'),
                  tone: console.executeEnabled ? 'ok' : 'warn' },
                { label: t('db.console.changes'), value: dirtyKeys.length },
                {
                  label: 'Root',
                  value: console.isRoot ? t('common.yes') : t('common.no'),
                  tone: console.isRoot ? 'ok' : 'warn' },
                {
                  label: t('systemd.bootEnabled'),
                  value:
                    console.enabled === 'enabled' ? t('common.yes') : console.enabled ?? '—' },
              ] }
          : undefined
      }
      actions={<ActionBar>
          <Link to={link.path}>
            <Button variant="secondary" size="sm">
              {link.label}
            </Button>
          </Link>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => {
              setError(null);
              setMsg(null);
              void refresh();
            }}
          >
            {t('common.refresh')}
          </Button>
        </ActionBar>
      }
    >
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {console?.blockedByExclusive === 'mariadb-server' ? (
        <Alert variant="info">
          {t('db.exclusiveMariaHint')}{' '}
          <Link to="/databases/mariadb/service">{t('db.openMariaService')}</Link>
        </Alert>
      ) : null}
      {console?.blockedByExclusive === 'mysql-server' ? (
        <Alert variant="info">
          {t('db.exclusiveMysqlHint')}{' '}
          <Link to="/databases/mysql/service">{t('db.openMysqlService')}</Link>
        </Alert>
      ) : null}
      {console?.blockMessage && !console.blockedByExclusive ? (
        <Alert variant="info">{console.blockMessage}</Alert>
      ) : null}

      <PageTabs tabs={tabs} active={tab} onChange={setTab} variant="scroll">
        {tab === 'overview' && console ? (
          <Card>
            <CardSection title={t('db.serviceOverview')} description={t('db.console.overviewDesc')}>
              <DescriptionList columns={2} items={overviewItems} />
              <p className="muted u-text-sm u-mt-4">
                {t('db.console.lifecycleNote')}
              </p>
            </CardSection>
          </Card>
        ) : null}

        {tab === 'lifecycle' && console ? (
          <Card>
            <CardSection title={t('common.lifecycle')} description={t('db.console.lifecycleDesc')}>
              {!console.installed ? (
                <p className="muted u-text-sm u-mb-0">
                  {t('db.console.installEngine', { title: console.title })}
                </p>
              ) : (
                <div className="lifecycle-toolbar">
                  <Button variant="primary" size="md" loading={busy} onClick={bindCall1(doLifecycle, 'start')}>
                    {t('services.action.start')}
                  </Button>
                  <Button variant="secondary" size="md" loading={busy} onClick={() => setPendingLc('stop')}>
                    {t('services.action.stop')}
                  </Button>
                  <Button variant="secondary" size="md" loading={busy} onClick={() => setPendingLc('restart')}>
                    {t('services.action.restart')}
                  </Button>
                  <Button variant="secondary" size="md" loading={busy} onClick={bindCall1(doLifecycle, 'reload')}>
                    {t('db.console.reloadConfig')}
                  </Button>
                  <Button variant="ghost" size="md" loading={busy} onClick={bindCall1(doLifecycle, 'enable')}>
                    {t('systemd.bootEnabled')}
                  </Button>
                  <Button variant="ghost" size="md" loading={busy} onClick={bindCall1(doLifecycle, 'disable')}>
                    {t('db.console.disableBoot')}
                  </Button>
                </div>
              )}
              <div className="u-mt-3">
                <ServiceAccessStrip serviceId={svcId} />
              </div>
              <p className="muted u-text-sm u-mt-3">
                {t('db.console.needRights')}
              </p>
            </CardSection>
          </Card>
        ) : null}

        <ConfirmDialog
          open={pendingLc != null}
          onClose={() => !busy && setPendingLc(null)}
          onConfirm={() => {
            const action = pendingLc;
            setPendingLc(null);
            if (action) void doLifecycle(action);
          }}
          title={t('services.stopConfirmTitle', { label: console?.title ?? engine })}
          description={
            pendingLc === 'restart'
              ? t('db.console.needRestart')
              : t('services.stopConfirmDesc', { label: console?.title ?? engine })
          }
          severity="destructive"
          confirmLabel={
            pendingLc === 'restart' ? t('services.action.restart') : t('services.action.stop')
          }
          busy={busy}
        />

        <ServiceExposureDialog
          open={startGate.pending}
          onClose={startGate.dismiss}
          serviceId={svcId}
          initial={startGate.status}
          title={t('serviceExposure.privateStartTitle', { service: console?.title ?? engine })}
          confirmLabel={t('serviceExposure.confirmAndStart')}
          decisionOnly
          onSaved={async (decision) => {
            startGate.dismiss();
            await doLifecycle('start', {
              exposureDecision: decision.exposureDecision,
              allowFrom: decision.allowFrom,
            });
          }}
        />

        {tab === 'cluster' ? <DbClusterPanel engine={engine} /> : null}

        {console?.categories.map((cat) =>
          tab === cat.id ? (
            <Card key={cat.id}>
              <CardSection title={cat.label}>{categoryBody(cat)}</CardSection>
            </Card>
          ) : null,
        )}
      
        {tab === 'stack' ? (
          <div className="tab-panel stack">
            <SoftwareInstallBanner
              feature={engine}
              title={t('db.console.softwareMissing', {
                title: console?.title ?? engine,
              })}
              onInstalled={() => void refresh()}
              showReadyActions={false}
            />
            <SoftwareVersionBar
              softwareId={
                engine === 'mysql'
                  ? 'mysql-server'
                  : engine === 'mariadb'
                    ? 'mariadb-server'
                    : engine === 'postgres'
                      ? 'postgresql'
                      : 'redis-server'
              }
            />
          </div>
        ) : null}

        {tab === 'about' ? (
          <PageGuide
            guideId={
              engine === 'postgres'
                ? 'postgresService'
                : engine === 'redis'
                  ? 'redisService'
                  : engine === 'mariadb'
                    ? 'mariadbService'
                    : 'mysqlService'
            }
          />
        ) : null}
      </PageTabs>

      <OpsResultPanel title={t('systemd.opsResult')} result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
