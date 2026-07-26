/**
 * PHP runtime — probe + install + pool apply (Node-parity UX).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  FeaturePageLayout,
  Field,
  OpsResultPanel,
  SettingField,
  SettingFieldList,
  SoftwareInstallBanner,
  SummaryStrip,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { getServerContext, setServerContext } from '../../shared/stores/server-context';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { api } from '../../shared/services/api';

type ToolsProbe = {
  php?: { version?: string; modules: string[] };
  composer?: { available: boolean; version?: string };
  wpCli?: { available: boolean; version?: string };
  notes?: string[];
};

export function PhpRuntimePage() {
  const ctx = getServerContext();
  const [domain, setDomain] = useState(`php.${ctx.domain}`);
  const [poolName, setPoolName] = useState('demo');
  const [version, setVersion] = useState('8.2');
  const [enableSite, setEnableSite] = useState(false);
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const [tools, setTools] = useState<ToolsProbe | null>(null);
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <FeaturePageLayout
      title="PHP 執行環境"
      subtitle="PHP 版本、FPM pool 與站點"
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

      <SummaryStrip
        items={[
          { label: '目標 PHP', value: version },
          { label: 'Pool', value: poolName || '—' },
          { label: 'Domain', value: domain || '—' },
        ]}
      />

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
        <CardSection
          title="Composer / WP-CLI / 模組"
          description="即時探測 PATH 上工具與 php -m（唯讀）"
        >
          <div className="btn-row u-mb-3">
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
          </div>
          {tools ? (
            <>
              <DescriptionList
                columns={2}
                items={[
                  {
                    label: 'PHP',
                    value: tools.php?.version ?? '未找到',
                  },
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
              {tools.notes?.length ? (
                <ul className="list-plain u-mt-2">
                  {tools.notes.map((n) => (
                    <li key={n} className="muted u-text-sm">
                      {n}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="muted">按「重新探測工具」載入</p>
          )}
        </CardSection>
      </Card>

      <Card>
        <CardSection title="安裝 PHP" description="需系統變更權限">
          <Field label="PHP 版本" techKey="version" htmlFor="php-ver">
            <select id="php-ver" value={version} onChange={(e) => setVersion(e.target.value)}>
              <option value="8.1">8.1</option>
              <option value="8.2">8.2</option>
              <option value="8.3">8.3</option>
            </select>
          </Field>
          <div className="setting-actions-bar">
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
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection title="PHP 站點 / Pool" description="寫入 pool 與 vhost；可選重載服務">
          <SettingFieldList>
            <SettingField label="網域" techKey="domain" htmlFor="php-dom">
              <input
                id="php-dom"
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value);
                  setServerContext({ domain: e.target.value.replace(/^php\./, '') });
                }}
              />
            </SettingField>
            <SettingField label="Pool 名稱" techKey="pool" htmlFor="php-pool">
              <input
                id="php-pool"
                value={poolName}
                onChange={(e) => setPoolName(e.target.value)}
              />
            </SettingField>
            <SettingField
              label="啟用並重載"
              techKey="enable_site"
              description="需要系統變更權限"
              htmlFor="php-en"
            >
              <select
                id="php-en"
                value={enableSite ? 'yes' : 'no'}
                onChange={(e) => setEnableSite(e.target.value === 'yes')}
              >
                <option value="yes">是</option>
                <option value="no">否（只寫管理檔）</option>
              </select>
            </SettingField>
          </SettingFieldList>
          <div className="setting-actions-bar">
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
          </div>
        </CardSection>
      </Card>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
