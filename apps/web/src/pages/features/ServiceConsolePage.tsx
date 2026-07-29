/**
 * Multi-category DB service console.
 * Overview = DescriptionList (never inputs). Settings = Form Kit (max 2 cols).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
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
  OpsHero,
  OpsResultPanel,
  PresetChips,
  SegRadio,
  Tabs,
  FeaturePageLayout,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import type { DbServiceEngine } from '../../features/db-service';
import {
  consoleApi,
  type ConsoleCategory,
  type ConsoleSetting,
  type ServiceConsole,
} from '../../features/db-service/console-api';
import { DbClusterPanel } from '../../features/db-service/DbClusterPanel';
import { useFeatureAction } from '../../features/system/useFeatureAction';

const DATA_LINK: Record<DbServiceEngine, { path: string; label: string }> = {
  redis: { path: '/databases/redis', label: '資料瀏覽' },
  mysql: { path: '/databases/mysql', label: '資料庫管理' },
  mariadb: { path: '/databases/mariadb', label: '資料庫管理' },
  postgres: { path: '/databases/postgres', label: '資料庫管理' },
};

function applyModeLabel(m: string): string {
  if (m === 'runtime') return '即時';
  if (m === 'reload') return '重載';
  if (m === 'restart') return '需重啟';
  return m;
}

function displayValue(v?: string): string {
  if (v == null || v === '') return '';
  return v;
}

export function ServiceConsolePage({ engine }: { engine: DbServiceEngine }) {
  const [console, setConsole] = useState<ServiceConsole | null>(null);
  const [tab, setTab] = useState('lifecycle');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();
  const link = DATA_LINK[engine];

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
      setLoadError(e instanceof Error ? e.message : '載入失敗');
    }
  }, [engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dirtyKeys = useMemo(() => {
    if (!console) return [] as string[];
    const out: string[] = [];
    for (const cat of console.categories) {
      for (const s of cat.settings) {
        const live = displayValue(s.liveValue);
        const cur = draft[s.key] ?? live;
        if (cur !== live) out.push(s.key);
      }
    }
    return out;
  }, [console, draft]);

  const tabs = useMemo(() => {
    const base = [
      { id: 'lifecycle', label: '生命週期' },
      { id: 'overview', label: '概覽' },
      { id: 'cluster', label: '叢集' },
    ];
    if (!console) return base;
    return [...base, ...console.categories.map((c) => ({ id: c.id, label: c.label }))];
  }, [console]);

  async function doLifecycle(action: string) {
    await run(async () => {
      try {
        const r = await consoleApi.lifecycle(engine, action);
        await refresh();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : '操作失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, `已${action}`);
  }

  async function doInstall() {
    await run(async () => {
      try {
        const r = await consoleApi.install(engine);
        await refresh();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : '安裝失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, '安裝完成');
  }

  async function doApply(keys?: string[]) {
    const changes: Record<string, string> = {};
    const list = keys ?? dirtyKeys;
    for (const k of list) {
      if (draft[k] != null) changes[k] = draft[k];
    }
    if (!Object.keys(changes).length) {
      setError('沒有變更可套用');
      return;
    }
    await run(async () => {
      try {
        const r = await consoleApi.apply(engine, changes);
        await refresh();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : '套用失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, '設定已套用');
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
      if (s.enumValues.length <= 12) {
        const current = s.enumValues.includes(val) ? val : s.enumValues[0]!;
        return (
          <SegRadio
            name={id}
            aria-label={s.label}
            value={current}
            onChange={onChange}
            options={s.enumValues.map((x) => ({ value: x, label: x }))}
          />
        );
      }
      return (
        <select id={id} value={val} onChange={(e) => onChange(e.target.value)} aria-label={s.label}>
          {val === '' ? <option value="">— 未取得 —</option> : null}
          {s.enumValues.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      );
    }
    if (s.type === 'int' || s.type === 'number' || /port|timeout|conn|size|memory|buffer|worker|pool/i.test(s.key)) {
      const numish = val === '' || /^-?\d+(\.\d+)?$/.test(val.trim());
      if (numish) {
        const presets = /port/i.test(s.key)
          ? [
              { value: '3306', label: '3306' },
              { value: '5432', label: '5432' },
              { value: '6379', label: '6379' },
              { value: '8080', label: '8080' },
            ]
          : /timeout|idle/i.test(s.key)
            ? [
                { value: '0', label: '0' },
                { value: '30', label: '30' },
                { value: '60', label: '60' },
                { value: '300', label: '300' },
              ]
            : /conn|client|worker|pool/i.test(s.key)
              ? [
                  { value: '50', label: '50' },
                  { value: '100', label: '100' },
                  { value: '200', label: '200' },
                  { value: '500', label: '500' },
                ]
              : [
                  { value: '0', label: '0' },
                  { value: '1', label: '1' },
                  { value: '16', label: '16' },
                  { value: '64', label: '64' },
                  { value: '128', label: '128' },
                  { value: '256', label: '256' },
                ];
        return (
          <PresetChips
            options={presets}
            value={val}
            onChange={onChange}
            allowCustom
            customPlaceholder="自訂"
          />
        );
      }
    }
    return (
      <input
        id={id}
        value={val}
        onChange={(e) => onChange(e.target.value)}
        placeholder={s.liveValue == null ? '未從服務讀取' : undefined}
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
      mode ? `套用方式：${mode}` : null,
      dirty ? '已修改，尚未套用' : null,
      s.danger ? '高風險設定' : null,
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
      return <p className="muted">此分類暫無可用設定（或目前版本不支援）</p>;
    }
    const catDirty = dirtyKeys.filter((k) => rows.some((r) => r.key === k));
    return (
      <>
        {cat.description ? <FormHint>{cat.description}</FormHint> : null}
        <FormHint>
          「即時」可在線修改；「需重啟」套用後請到生命週期重啟服務。藍色底為尚未套用的變更。
        </FormHint>
        <FormLayout columns={2}>{rows.map(renderSetting)}</FormLayout>
        <FormActions>
          <Button
            variant="primary"
            size="md"
            loading={busy}
            disabled={!catDirty.length}
            onClick={() => void doApply(catDirty)}
          >
            套用本分類{catDirty.length ? `（${catDirty.length}）` : ''}
          </Button>
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            disabled={!dirtyKeys.length}
            onClick={() => void doApply()}
          >
            套用全部變更{dirtyKeys.length ? `（${dirtyKeys.length}）` : ''}
          </Button>
        </FormActions>
      </>
    );
  }

  const overviewItems = useMemo(() => {
    if (!console) return [];
    return [
      { label: '引擎', value: console.title },
      {
        label: '狀態',
        value: (
          <Badge tone={console.active === 'active' ? 'ok' : 'warn'}>{console.activeLabel}</Badge>
        ),
      },
      { label: 'systemd', value: console.unit },
      { label: '開機自啟', value: console.enabled ?? '—' },
      { label: '版本', value: console.version ?? '—' },
      {
        label: '系統變更',
        value: console.executeEnabled ? '已開啟' : '未開啟',
      },
      { label: '管理員', value: console.isRoot ? '是' : '否' },
      ...(console.metrics.Uptime
        ? [{ label: '運行秒數', value: console.metrics.Uptime }]
        : []),
      ...(console.metrics.Threads_connected
        ? [{ label: '目前連線', value: console.metrics.Threads_connected }]
        : []),
      ...(console.metrics.used_memory
        ? [{ label: '記憶體', value: console.metrics.used_memory }]
        : []),
      ...(console.metrics.connected_clients
        ? [{ label: '客戶端', value: console.metrics.connected_clients }]
        : []),
    ];
  }, [console]);

  return (
    <FeaturePageLayout
      title={`${console?.title ?? engine} 服務`}
      actions={
        <div className="btn-row">
          <Link to={link.path}>
            <Button variant="secondary" size="md">
              {link.label}
            </Button>
          </Link>
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => {
              setError(null);
              setMsg(null);
              void refresh();
            }}
          >
            重新整理
          </Button>
        </div>
      }
    >
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      {console ? (
        <>
        <OpsHero
          pill={console.activeLabel}
          pillTone={
            console.active === 'active' ? 'ok' : console.installed ? 'warn' : 'danger'
          }
          tone={console.active === 'active' ? 'ok' : 'warn'}
          cta={
            <>
              <Link to={link.path} className="btn btn--secondary btn--md">
                {link.label}
              </Link>
              <Button variant="ghost" size="md" loading={busy} onClick={() => void refresh()}>
                重新整理
              </Button>
            </>
          }
          stats={[
            {
              label: '狀態',
              value: (
                <Badge
                  tone={
                    console.active === 'active'
                      ? 'ok'
                      : console.installed
                        ? 'warn'
                        : 'danger'
                  }
                >
                  {console.activeLabel}
                </Badge>
              ),
            },
            {
              label: '版本',
              value: (
                <span className="ops-stat__val--sm">
                  {console.version?.replace(/^mysql\s+Ver\s+/i, '').slice(0, 28) ?? '—'}
                </span>
              ),
            },
            {
              label: 'EXECUTE',
              value: (
                <Badge tone={console.executeEnabled ? 'ok' : 'warn'}>
                  {console.executeEnabled ? '開' : '關'}
                </Badge>
              ),
            },
            {
              label: '變更',
              value: dirtyKeys.length,
            },
          ]}
          rail={
            <>
              <li>
                <span className="ops-rail__k">Root</span>
                <Badge tone={console.isRoot ? 'ok' : 'warn'}>
                  {console.isRoot ? '是' : '否'}
                </Badge>
              </li>
              <li>
                <span className="ops-rail__k">開機自啟</span>
                <span className="ops-rail__text">
                  {console.enabled === 'enabled' ? '是' : console.enabled ?? '—'}
                </span>
              </li>
            </>
          }
        />
        </>
      ) : null}

      {console?.blockMessage ? <Alert variant="info">{console.blockMessage}</Alert> : null}

      <Tabs tabs={tabs} active={tab} onChange={setTab} variant="scroll">
        {tab === 'overview' && console ? (
          <Card>
            <CardSection title="服務概覽" description="唯讀資訊，由探測取得（非輸入欄）">
              <DescriptionList columns={2} items={overviewItems} />
              <p className="muted u-text-sm u-mt-4" style={{ marginBottom: 0 }}>
                設定分頁中，「即時」可在線修改；「需重啟」套用後請到生命週期重啟服務。
              </p>
            </CardSection>
          </Card>
        ) : null}

        {tab === 'lifecycle' && console ? (
          <Card>
            <CardSection title="生命週期" description="安裝、啟動、停止與開機自啟">
              {!console.installed ? (
                <div className="lifecycle-toolbar">
                  <Button variant="primary" size="lg" loading={busy} onClick={() => void doInstall()}>
                    一鍵安裝 {console.title}
                  </Button>
                </div>
              ) : (
                <div className="lifecycle-toolbar">
                  <Button variant="primary" size="md" loading={busy} onClick={() => void doLifecycle('start')}>
                    啟動
                  </Button>
                  <Button variant="secondary" size="md" loading={busy} onClick={() => void doLifecycle('stop')}>
                    停止
                  </Button>
                  <Button variant="secondary" size="md" loading={busy} onClick={() => void doLifecycle('restart')}>
                    重啟
                  </Button>
                  <Button variant="secondary" size="md" loading={busy} onClick={() => void doLifecycle('reload')}>
                    重載設定
                  </Button>
                  <Button variant="ghost" size="md" loading={busy} onClick={() => void doLifecycle('enable')}>
                    開機自啟
                  </Button>
                  <Button variant="ghost" size="md" loading={busy} onClick={() => void doLifecycle('disable')}>
                    取消自啟
                  </Button>
                </div>
              )}
              <p className="muted u-text-sm u-mt-3" style={{ marginBottom: 0 }}>
                需要系統變更權限與管理員身分。失敗會顯示原因，不會假裝成功。
              </p>
            </CardSection>
          </Card>
        ) : null}

        {tab === 'cluster' ? <DbClusterPanel engine={engine} /> : null}

        {console?.categories.map((cat) =>
          tab === cat.id ? (
            <Card key={cat.id}>
              <CardSection title={cat.label}>{categoryBody(cat)}</CardSection>
            </Card>
          ) : null,
        )}
      </Tabs>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
