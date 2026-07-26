/**
 * @deprecated Not routed. Prefer ServiceConsolePage via *ServicePage wrappers.
 * Kept only for reference; do not wire dual UIs.
 *
 * Shared DB service settings page (Redis / MySQL / MariaDB / PostgreSQL).
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  FeaturePageLayout,
  OpsResultPanel,
  SettingField,
  SettingFieldList,
  SummaryStrip,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { dbServiceApi, type DbServiceEngine } from '../../features/db-service';
import { useFeatureAction } from '../../features/system/useFeatureAction';

const META: Record<
  DbServiceEngine,
  { title: string; dataPath: string; dataLabel: string }
> = {
  redis: { title: 'Redis 服務', dataPath: '/databases/redis', dataLabel: '資料瀏覽' },
  mysql: { title: 'MySQL 服務', dataPath: '/databases/mysql', dataLabel: '資料庫管理' },
  mariadb: { title: 'MariaDB 服務', dataPath: '/databases/mariadb', dataLabel: '資料庫管理' },
  postgres: { title: 'PostgreSQL 服務', dataPath: '/databases/postgres', dataLabel: '資料庫管理' },
};

export function DbServicePage({ engine }: { engine: DbServiceEngine }) {
  const meta = META[engine];
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await dbServiceApi.getSettings(engine);
      setSettings({ ...(r.settings as object) });
      setStatus(r.status);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '載入失敗');
    }
  }, [engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function patch(key: string, value: unknown) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await dbServiceApi.saveSettings(engine, settings);
      setSettings(r.settings);
      return { ok: true, notes: ['已儲存設定（尚未套用到系統）'] };
    }, '已儲存');
  }

  async function onApply() {
    await run(async () => {
      try {
        const r = await dbServiceApi.applySettings(engine, { settings });
        await refresh();
        return r as unknown as OpsResultLike;
      } catch (err) {
        const m = err instanceof Error ? err.message : '套用失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, '已套用');
  }

  const active = String(status?.active ?? status?.ping ?? '');
  const running =
    active === 'active' || String(status?.ping ?? '').toUpperCase() === 'PONG';
  const executeEnabled = Boolean(status?.executeEnabled);

  return (
    <FeaturePageLayout
      title={meta.title}
      subtitle="服務狀態與系統設定"
      actions={
        <div className="btn-row">
          <Link to={meta.dataPath}>
            <Button variant="secondary" size="md">
              {meta.dataLabel}
            </Button>
          </Link>
          <Button
            variant="secondary"
            size="md"
            disabled={busy}
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

      <SummaryStrip
        items={[
          {
            label: '狀態',
            value: running ? '運行中' : String(status?.active ?? '—'),
            tone: running ? 'ok' : 'warn',
          },
          {
            label: '系統變更',
            value: executeEnabled ? '已開啟' : '未開啟',
            tone: executeEnabled ? 'ok' : 'warn',
          },
          {
            label: '管理員',
            value: status?.isRoot ? '是' : '否',
            tone: status?.isRoot ? 'ok' : 'warn',
          },
          ...(engine === 'redis'
            ? [
                {
                  label: '資料庫數量',
                  value: String(
                    status?.configuredDatabases ?? status?.databases ?? settings.databases ?? 16,
                  ),
                },
              ]
            : []),
          {
            label: '埠',
            value: String(settings.port ?? '—'),
          },
        ]}
      />

      {status?.blockMessage ? (
        <Alert variant="info">{String(status.blockMessage)}</Alert>
      ) : null}

      <Card>
        <CardSection title="服務概覽" description="唯讀狀態">
          <DescriptionList
            columns={2}
            items={[
              {
                label: '狀態',
                value: (
                  <Badge tone={running ? 'ok' : 'warn'}>
                    {running ? '運行中' : String(status?.active ?? '—')}
                  </Badge>
                ),
              },
              { label: '埠', value: String(settings.port ?? '—') },
              {
                label: '系統變更',
                value: executeEnabled ? '已開啟' : '未開啟',
              },
              { label: '管理員', value: status?.isRoot ? '是' : '否' },
              ...(engine === 'redis'
                ? [
                    {
                      label: '資料庫數量',
                      value: String(
                        status?.configuredDatabases ?? status?.databases ?? settings.databases ?? 16,
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title="服務設定"
          description="儲存只寫入管理面；「套用到系統」會寫入設定檔並重啟服務（需權限）"
        >
          <form id="db-svc-form" onSubmit={(e) => void onSave(e)}>
            {engine === 'redis' ? (
              <SettingFieldList>
                <SettingField label="監聽埠" techKey="port" htmlFor="port">
                  <input
                    id="port"
                    type="number"
                    value={Number(settings.port ?? 6379)}
                    onChange={(e) => patch('port', Number(e.target.value) || 6379)}
                  />
                </SettingField>
                <SettingField label="Bind 位址" techKey="bind" htmlFor="bind">
                  <input
                    id="bind"
                    value={String(settings.bind ?? '127.0.0.1')}
                    onChange={(e) => patch('bind', e.target.value)}
                  />
                </SettingField>
                <SettingField
                  label="資料庫數量"
                  techKey="databases"
                  description="編號 0…N−1；改動後需套用並重啟"
                  htmlFor="databases"
                >
                  <input
                    id="databases"
                    type="number"
                    min={1}
                    max={256}
                    value={Number(settings.databases ?? 16)}
                    onChange={(e) => patch('databases', Number(e.target.value) || 16)}
                  />
                </SettingField>
                <SettingField label="記憶體上限" techKey="maxmemory" description="如 256mb，0=不限" htmlFor="maxmemory">
                  <input
                    id="maxmemory"
                    value={String(settings.maxmemory ?? '0')}
                    onChange={(e) => patch('maxmemory', e.target.value)}
                  />
                </SettingField>
                <SettingField label="淘汰策略" techKey="maxmemory-policy" htmlFor="policy">
                  <select
                    id="policy"
                    value={String(settings.maxmemoryPolicy ?? 'noeviction')}
                    onChange={(e) => patch('maxmemoryPolicy', e.target.value)}
                  >
                    <option value="noeviction">noeviction</option>
                    <option value="allkeys-lru">allkeys-lru</option>
                    <option value="volatile-lru">volatile-lru</option>
                    <option value="allkeys-lfu">allkeys-lfu</option>
                    <option value="volatile-ttl">volatile-ttl</option>
                  </select>
                </SettingField>
                <SettingField label="密碼" techKey="requirepass" htmlFor="pass">
                  <input
                    id="pass"
                    type="password"
                    value={String(settings.requirepass ?? '')}
                    onChange={(e) => patch('requirepass', e.target.value)}
                    autoComplete="new-password"
                  />
                </SettingField>
                <SettingField label="閒置逾時" techKey="timeout" description="秒；0=不限" htmlFor="timeout">
                  <input
                    id="timeout"
                    type="number"
                    value={Number(settings.timeout ?? 0)}
                    onChange={(e) => patch('timeout', Number(e.target.value) || 0)}
                  />
                </SettingField>
                <SettingField label="AOF" techKey="appendonly" htmlFor="appendonly">
                  <select
                    id="appendonly"
                    value={settings.appendonly ? 'yes' : 'no'}
                    onChange={(e) => patch('appendonly', e.target.value === 'yes')}
                  >
                    <option value="yes">開啟</option>
                    <option value="no">關閉</option>
                  </select>
                </SettingField>
                <SettingField label="保護模式" techKey="protected-mode" htmlFor="protectedMode">
                  <select
                    id="protectedMode"
                    value={settings.protectedMode !== false ? 'yes' : 'no'}
                    onChange={(e) => patch('protectedMode', e.target.value === 'yes')}
                  >
                    <option value="yes">開啟</option>
                    <option value="no">關閉</option>
                  </select>
                </SettingField>
              </SettingFieldList>
            ) : engine === 'postgres' ? (
              <SettingFieldList>
                <SettingField label="埠" techKey="port" htmlFor="port">
                  <input
                    id="port"
                    type="number"
                    value={Number(settings.port ?? 5432)}
                    onChange={(e) => patch('port', Number(e.target.value) || 5432)}
                  />
                </SettingField>
                <SettingField label="監聽位址" techKey="listen_addresses" htmlFor="listen">
                  <input
                    id="listen"
                    value={String(settings.listenAddresses ?? 'localhost')}
                    onChange={(e) => patch('listenAddresses', e.target.value)}
                  />
                </SettingField>
                <SettingField label="最大連線" techKey="max_connections" htmlFor="mc">
                  <input
                    id="mc"
                    type="number"
                    value={Number(settings.maxConnections ?? 100)}
                    onChange={(e) => patch('maxConnections', Number(e.target.value) || 100)}
                  />
                </SettingField>
              </SettingFieldList>
            ) : (
              <SettingFieldList>
                <SettingField label="埠" techKey="port" htmlFor="port">
                  <input
                    id="port"
                    type="number"
                    value={Number(settings.port ?? 3306)}
                    onChange={(e) => patch('port', Number(e.target.value) || 3306)}
                  />
                </SettingField>
                <SettingField label="綁定位址" techKey="bind_address" htmlFor="bind">
                  <input
                    id="bind"
                    value={String(settings.bindAddress ?? '127.0.0.1')}
                    onChange={(e) => patch('bindAddress', e.target.value)}
                  />
                </SettingField>
                <SettingField label="最大連線" techKey="max_connections" htmlFor="mc">
                  <input
                    id="mc"
                    type="number"
                    value={Number(settings.maxConnections ?? 151)}
                    onChange={(e) => patch('maxConnections', Number(e.target.value) || 151)}
                  />
                </SettingField>
                <SettingField label="字元集" techKey="character_set_server" htmlFor="cs">
                  <input
                    id="cs"
                    value={String(settings.characterSetServer ?? 'utf8mb4')}
                    onChange={(e) => patch('characterSetServer', e.target.value)}
                  />
                </SettingField>
              </SettingFieldList>
            )}

            <div className="setting-actions-bar">
              <Button type="submit" variant="secondary" size="md" loading={busy}>
                儲存設定
              </Button>
              <Button type="button" variant="primary" size="md" loading={busy} onClick={() => void onApply()}>
                套用到系統並重啟
              </Button>
            </div>
          </form>
        </CardSection>
      </Card>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />

      {engine === 'redis' && running ? (
        <p className="muted u-text-sm">
          <Badge tone="ok">提示</Badge> 資料庫數量改動後，請到「資料瀏覽」用 0…N−1 切換庫。
        </p>
      ) : null}
    </FeaturePageLayout>
  );
}
