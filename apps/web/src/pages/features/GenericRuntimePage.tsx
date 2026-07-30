/**
 * Shared runtime page — Node / Python / Go / Rust
 * Probe + install + panel tuning (env → deploy / systemd).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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

  buttonClassName,} from '../../shared/components/ui';
import { Link } from 'react-router-dom';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';

export type HostingRuntimeKind = 'node' | 'php' | 'python' | 'go' | 'rust';
type TuningKind = 'node' | 'python' | 'go' | 'rust';

const META: Record<
  HostingRuntimeKind,
  {
    title: string;
    defaultVersion: string;
    versions: string[];
    installLabel: (v: string) => string;
    bannerTitle: string;
  }
> = {
  node: {
    title: 'Node.js',
    defaultVersion: '20',
    versions: ['18', '20', '22'],
    installLabel: (v) => `安裝 Node ${v}`,
    bannerTitle: 'Node.js 尚未安裝',
  },
  php: {
    title: 'PHP',
    defaultVersion: '8.2',
    versions: ['8.1', '8.2', '8.3'],
    installLabel: (v) => `安裝 PHP ${v}`,
    bannerTitle: 'PHP 尚未安裝',
  },
  python: {
    title: 'Python',
    defaultVersion: '3.12',
    versions: ['3.10', '3.11', '3.12'],
    installLabel: (v) => `安裝 Python ${v}`,
    bannerTitle: 'Python 尚未安裝',
  },
  go: {
    title: 'Go',
    defaultVersion: '1.22',
    versions: ['1.21', '1.22', '1.23'],
    installLabel: (v) => `安裝 Go ${v}`,
    bannerTitle: 'Go 尚未安裝',
  },
  rust: {
    title: 'Rust',
    defaultVersion: 'stable',
    versions: ['stable', '1.78', '1.81'],
    installLabel: (v) => `安裝 Rust ${v}`,
    bannerTitle: 'Rust／cargo 尚未安裝',
  },
};

const RT_TABS = ['overview', 'tuning'] as const;

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

function isTuningKind(k: HostingRuntimeKind): k is TuningKind {
  return k === 'node' || k === 'python' || k === 'go' || k === 'rust';
}

export function GenericRuntimePage({ kind }: { kind: HostingRuntimeKind }) {
  const meta = META[kind];
  const [tab, setTab] = usePageTab(RT_TABS, 'overview');
  const [version, setVersion] = useState(meta.defaultVersion);
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const [catalog, setCatalog] = useState<TuningGroup[]>([]);
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [extraEnv, setExtraEnv] = useState('');
  const [envPreview, setEnvPreview] = useState<Record<string, string>>({});
  const [tuningLoaded, setTuningLoaded] = useState(false);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

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

  useEffect(() => {
    if (tab === 'tuning' && isTuningKind(kind)) {
      void loadTuning().catch((e) =>
        setError(e instanceof Error ? e.message : '載入調校失敗'),
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
              : 'hostRust';
    return {
      items,
      available,
      host: p?.[hostKey] != null ? String(p[hostKey]) : '—',
      supported: supported?.[kind] ?? meta.versions,
      notes: Array.isArray(p?.notes) ? (p!.notes as string[]) : [],
    };
  }, [probe, kind, meta.versions]);

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
            ? `${probeData.available.length} 可用`
            : '未探測到',
          tone: probeData.available.length ? 'ok' : 'warn',
        },
        items: [
          {
            label: '探測',
            value: probe ? '已讀' : '—',
            tone: probe ? 'ok' : 'neutral',
          },
          { label: '可用', value: probeData.available.length || 0 },
          { label: '目標', value: version },
          { label: '調校', value: tuningLoaded ? '已載' : '—' },
          { label: '主機', value: probeData.host || '—' },
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
                return { ok: true, notes: ['已探測'], ...r } as unknown as OpsResultLike;
              }, '已探測');
            }}
          >
            重新探測
          </Button>
          <Link to="/projects" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            專案
          </Link>
        </>
      }
    >
      <SoftwareInstallBanner feature={kind} title={meta.bannerTitle} />
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          { id: 'overview', label: '總覽 / 安裝' },
          { id: 'tuning', label: '執行調校' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'overview' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title="探測結果" description="唯讀 · 安裝成功後請再探測確認">
                <DescriptionList
                  columns={2}
                  items={[
                    { label: '主機預設', value: probeData.host },
                    {
                      label: '面板支援',
                      value: probeData.supported.join(', '),
                    },
                    {
                      label: '已就緒',
                      value: probeData.available.length ? (
                        <span /* was action-bar */>
                          {probeData.available.map((v) => (
                            <Badge key={v} tone="ok">
                              {v}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        '尚未偵測到'
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
                          {i.available ? '可用' : '未找到'}
                        </Badge>
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
                  <p className="muted u-mt-2">按「重新探測」載入主機版本矩陣</p>
                )}
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title="安裝"
                description="需系統變更權限與管理員；安裝 toolchain ≠ 專案已對外"
              >
                <FormLayout columns={2}>
                  <Field label="目標版本" htmlFor={`rt-${kind}-ver`} flush required>
                    {(() => {
                      const vers =
                        probeData.supported.length ? probeData.supported : meta.versions;
                      if (vers.length <= 8) {
                        return (
                          <SegRadio
                            name={`rt-${kind}-ver`}
                            aria-label="目標版本"
                            value={version}
                            onChange={setVersion}
                            options={vers.map((v) => ({ value: v, label: v }))}
                          />
                        );
                      }
                      return (
                        <select
                          id={`rt-${kind}-ver`}
                          value={version}
                          onChange={(e) => setVersion(e.target.value)}
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
                  寫入安裝腳本後，有權限才會真正執行。調校在「執行調校」分頁；重新部署專案後才進行程。
                </FormHint>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await systemApi.runtimeInstall({
                          kind,
                          version,
                          install: true,
                        });
                        await refresh();
                        return r as OpsResultLike;
                      }, meta.installLabel(version))
                    }
                  >
                    {meta.installLabel(version)}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'tuning' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="面板調校"
                description="寫入管理檔；部署時注入 env"
              >
                <FormLayout columns={2}>
                  <Field label="綁定版本" htmlFor={`tune-${kind}-ver`} flush>
                    {(() => {
                      const vers =
                        probeData.supported.length ? probeData.supported : meta.versions;
                      if (vers.length <= 8) {
                        return (
                          <SegRadio
                            name={`tune-${kind}-ver`}
                            aria-label="綁定版本"
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
                          onChange={(e) => setVersion(e.target.value)}
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
                  Node：max-old-space-size 等會合成 NODE_OPTIONS。Go／Python／Rust 對應官方環境變數。
                </FormHint>
              </CardSection>
            </Card>

            {catalog.map((group) => (
              <Card key={group.id}>
                <CardSection title={group.title} description="每一列一個設定">
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
                              label={val === true || val === 1 || val === '1' ? '開啟' : '關閉'}
                              checked={val === true || val === 1 || val === '1'}
                              onChange={(c) => setValue(f.key, c)}
                            />
                          ) : f.type === 'select' && f.options ? (
                            f.options.length <= 8 ? (
                              <SegRadio
                                name={id}
                                aria-label={f.label}
                                value={String(val)}
                                onChange={(v) => setValue(f.key, v)}
                                options={f.options.map((o) => ({
                                  value: o.value,
                                  label: o.label,
                                }))}
                              />
                            ) : (
                              <select
                                id={id}
                                value={String(val)}
                                onChange={(e) => setValue(f.key, e.target.value)}
                              >
                                {f.options.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            )
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
                                            { value: '0', label: '0 全' },
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
                              customPlaceholder="自訂"
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
              <CardSection title="額外環境變數" description="一行 KEY=value">
                <FormLayout columns={1}>
                  <Field label="自訂 env" htmlFor={`tune-${kind}-extra`} flush fullWidth>
                    <textarea
                      id={`tune-${kind}-extra`}
                      rows={4}
                      value={extraEnv}
                      onChange={(e) => setExtraEnv(e.target.value)}
                      placeholder="MY_APP_FLAG=1"
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
              </CardSection>
            </Card>

            {Object.keys(envPreview).length > 0 ? (
              <Card>
                <CardSection title="Env 預覽" description="儲存後／上次載入的合併結果">
                  <DescriptionList
                    columns={2}
                    items={Object.entries(envPreview).map(([k, v]) => ({
                      label: k,
                      value: v,
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
                    if (!isTuningKind(kind)) return { ok: false, notes: ['不支援'] };
                    const r = await systemApi.runtimeTuningSave(kind, {
                      version,
                      values,
                      env: parseExtraEnv(),
                    });
                    await loadTuning();
                    return r as OpsResultLike;
                  }, '已儲存調校')
                }
              >
                儲存調校
              </Button>
              <Button
                variant="ghost"
                size="md"
                loading={busy}
                onClick={() =>
                  void loadTuning().catch((e) =>
                    setError(e instanceof Error ? e.message : '重新載入失敗'),
                  )
                }
              >
                重新載入
              </Button>
            </FormActions>
          </div>
        ) : null}
      </PageTabs>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
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
