/**
 * PHP runtime — Overview · php.ini · FPM/站點 · 工具
 */
import { useCallback, useEffect, useState } from 'react';
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
  SoftwareInstallBanner,
  OpsHero,
  Tabs,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { getServerContext, setServerContext } from '../../shared/stores/server-context';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { api } from '../../shared/services/api';
import { usePageTab } from '../../shared/hooks/usePageTab';

type ToolsProbe = {
  php?: { version?: string; modules: string[] };
  composer?: { available: boolean; version?: string };
  wpCli?: { available: boolean; version?: string };
  notes?: string[];
};

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

const PHP_TABS = ['overview', 'ini', 'site', 'tools'] as const;

export function PhpRuntimePage() {
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
        setError(e instanceof Error ? e.message : '載入 php.ini 失敗'),
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
      title="PHP 執行環境"
      subtitle="版本、php.ini、FPM pool 與站點 — 寫入 ≠ 已套用到系統"
      actions={
        <Button
          variant="secondary"
          size="md"
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
      }
    >
      <SoftwareInstallBanner feature="php" title="PHP 尚未安裝" />
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      <OpsHero
        eyebrow="PHP"
        title="PHP 執行環境"
        pill={version}
        pillTone="ok"
        tone="ok"
        hint="版本、php.ini、FPM pool 與站點。寫入 ≠ 已套用到系統。"
        stats={[
          { label: '目標 PHP', value: version },
          { label: 'FPM Pool', value: poolName || '—' },
          {
            label: 'php.ini',
            value: iniLoaded ? (iniUpdatedAt ? '已載入' : '預設') : '—',
          },
          { label: '網域', value: domain || '—' },
        ]}
      />

      <Tabs
        tabs={[
          { id: 'overview', label: '總覽' },
          { id: 'ini', label: 'php.ini' },
          { id: 'site', label: 'FPM / 站點' },
          { id: 'tools', label: '工具' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'overview' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title="安裝 PHP" description="需系統變更權限；安裝 ≠ 已設定 FPM／ini">
                <FormLayout columns={2}>
                  <Field label="PHP 版本" htmlFor="php-ver" flush required>
                    <select
                      id="php-ver"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                    >
                      <option value="8.1">8.1</option>
                      <option value="8.2">8.2</option>
                      <option value="8.3">8.3</option>
                    </select>
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
                      }, `已安裝 PHP ${version}`)
                    }
                  >
                    安裝 PHP {version}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>

            {probe ? (
              <Card>
                <CardSection title="探測結果" description="唯讀">
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
              <CardSection title="下一步" description="建議流程">
                <ol className="list-plain list-spaced">
                  <li>
                    在 <strong>php.ini</strong> 分頁設計全域數值並儲存
                  </li>
                  <li>
                    可選：<strong>套用到系統</strong>（寫入 /etc/php/…/conf.d，需 root）
                  </li>
                  <li>
                    專案部署時會把合併後 ini 寫入 FPM pool 的 php_admin_*
                  </li>
                  <li>專案可再覆寫個別鍵（專案 → 部署）</li>
                </ol>
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'ini' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="全域 php.ini"
                description="每一列一個設定值（表單）。寫入管理檔後可「套用到系統」或於專案部署注入 pool"
              >
                <FormLayout columns={2}>
                  <Field label="PHP 版本" htmlFor="ini-ver" flush required>
                    <select
                      id="ini-ver"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                    >
                      <option value="8.1">8.1</option>
                      <option value="8.2">8.2</option>
                      <option value="8.3">8.3</option>
                    </select>
                  </Field>
                  <Field label="管理檔路徑" htmlFor="ini-path" flush>
                    <input id="ini-path" value={managedPath || '—'} readOnly spellCheck={false} />
                  </Field>
                </FormLayout>
                <FormHint>
                  變更會先存到面板 dataDir；「套用到系統」才複製到 /etc/php 並 reload FPM。專案 pool
                  會在部署時注入 php_admin_value。
                </FormHint>
              </CardSection>
            </Card>

            {!iniLoaded && !error ? (
              <Card>
                <CardSection title="載入中">
                  <p className="muted">正在讀取 php.ini 設定表單…</p>
                </CardSection>
              </Card>
            ) : null}

            {iniLoaded && catalog.length === 0 ? (
              <Card>
                <CardSection title="無法載入設定表">
                  <p className="muted">catalog 為空 — 請重新載入或確認 API 已啟動。</p>
                  <FormActions>
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() =>
                        void loadIni(version).catch((e) =>
                          setError(e instanceof Error ? e.message : '重新載入失敗'),
                        )
                      }
                    >
                      重新載入表單
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
                        f.danger ? '敏感設定，請小心' : undefined,
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
                              label={val === true || val === 1 || val === '1' ? '開啟' : '關閉'}
                              checked={val === true || val === 1 || val === '1'}
                              onChange={(c) => setValue(f.key, c)}
                            />
                          ) : f.type === 'select' && f.options ? (
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
                          ) : f.type === 'textarea' ? (
                            <textarea
                              id={id}
                              rows={3}
                              value={String(val ?? '')}
                              onChange={(e) => setValue(f.key, e.target.value)}
                              spellCheck={false}
                            />
                          ) : f.type === 'int' ? (
                            <input
                              id={id}
                              type="number"
                              value={Number(val)}
                              onChange={(e) => setValue(f.key, Number(e.target.value))}
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
                title="進階：額外鍵與 raw"
                description="catalog 未列的指令；每行 key=value；raw 直接附加到 ini 尾"
              >
                <FormLayout columns={1}>
                  <Field
                    label="額外指令"
                    htmlFor="ini-extra"
                    techKey="extra"
                    hint="每行一個 key=value（非上方表單已有的鍵）"
                    flush
                    fullWidth
                  >
                    <textarea
                      id="ini-extra"
                      rows={4}
                      value={extraText}
                      onChange={(e) => setExtraText(e.target.value)}
                      placeholder="variables_order=GPCS"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    label="Raw append"
                    htmlFor="ini-raw"
                    techKey="rawAppend"
                    hint="直接附加到 ini 檔末尾"
                    flush
                    fullWidth
                  >
                    <textarea
                      id="ini-raw"
                      rows={4}
                      value={rawAppend}
                      onChange={(e) => setRawAppend(e.target.value)}
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
                  }, '已儲存 php.ini')
                }
              >
                儲存 php.ini
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
                  }, '已套用到系統')
                }
              >
                套用到系統
              </Button>
              <Button
                variant="ghost"
                size="md"
                loading={busy}
                onClick={() => {
                  setError(null);
                  void loadIni(version).catch((e) =>
                    setError(e instanceof Error ? e.message : '重新載入失敗'),
                  );
                }}
              >
                重新載入
              </Button>
            </FormActions>
          </div>
        ) : null}

        {tab === 'site' ? (
          <div className="tab-panel">
            <Alert variant="info">
              <strong>生產站請用「專案」路徑</strong>
              ：建立 PHP 專案 → 部署／套用 FPM（pool = 專案 Linux 用戶 + 隔離 home）。本頁係{' '}
              <strong>系統級 demo／工具</strong>
              （手填 pool 名），唔會自動綁專案隔離。php.ini 全域預設請用「php.ini」分頁。
            </Alert>
            <Card>
              <CardSection
                title="系統工具：示範 vhost / Pool"
                description="進階／除錯用；日常開站請到 專案 → 部署"
              >
                <FormLayout columns={2}>
                  <Field label="網域" htmlFor="php-dom" flush required hint="虛擬主機 server_name">
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
                    label="Pool 名稱"
                    htmlFor="php-pool"
                    flush
                    required
                    hint="手填識別名（示範）；專案路徑會用 ysks_* 用戶"
                  >
                    <input
                      id="php-pool"
                      value={poolName}
                      onChange={(e) => setPoolName(e.target.value)}
                      placeholder="demo"
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
                <div className="form-check-row u-mt-4">
                  <CheckboxField
                    id="php-en"
                    label="啟用並重載服務"
                    description="需要系統變更權限；關閉則只寫管理檔"
                    checked={enableSite}
                    onChange={setEnableSite}
                  />
                </div>
                <FormHint>
                  套用成功 = 檔案已寫入（written）。生產請優先用專案部署，確保 User=專案 Linux 用戶。
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
                          const m = e instanceof Error ? e.message : '套用失敗';
                          return { ok: false, blocked: true, blockMessage: m, notes: [m] };
                        }
                      }, '已套用 PHP vhost / pool')
                    }
                  >
                    套用 PHP vhost / pool
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
                title="Composer / WP-CLI / 模組"
                description="即時探測 PATH 上工具與 php -m（唯讀）"
              >
                <FormActions>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        const t = await api.requestRaw<ToolsProbe>('/api/v1/runtimes/tools');
                        setTools(t);
                        return {
                          ok: true,
                          notes: t.notes ?? ['已探測工具'],
                        } as OpsResultLike;
                      }, '已探測工具')
                    }
                  >
                    重新探測工具
                  </Button>
                </FormActions>
                {tools ? (
                  <>
                    <DescriptionList
                      columns={2}
                      items={[
                        { label: 'PHP', value: tools.php?.version ?? '未找到' },
                        {
                          label: 'Composer',
                          value: tools.composer?.available ? (
                            <Badge tone="ok">{tools.composer.version ?? '可用'}</Badge>
                          ) : (
                            <Badge tone="warn">不可用</Badge>
                          ),
                        },
                        {
                          label: 'WP-CLI',
                          value: tools.wpCli?.available ? (
                            <Badge tone="ok">{tools.wpCli.version ?? '可用'}</Badge>
                          ) : (
                            <Badge tone="warn">不可用</Badge>
                          ),
                        },
                        {
                          label: '模組數',
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
                  <p className="muted">按「重新探測工具」載入</p>
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}
      </Tabs>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
