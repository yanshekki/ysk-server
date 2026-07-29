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
              <>
                <FormLayout columns={2}>
                  <Field label="監聽埠" htmlFor="port" flush hint="預設 6379">
                    <PresetChips
                      options={[
                        { value: '6379', label: '6379' },
                        { value: '6380', label: '6380' },
                        { value: '16379', label: '16379' },
                      ]}
                      value={String(settings.port ?? 6379)}
                      onChange={(v) => patch('port', Number(v) || 6379)}
                      allowCustom
                      customPlaceholder="自訂埠"
                    />
                  </Field>
                  <Field label="綁定位址" htmlFor="bind" flush hint="建議本機">
                    <SegRadio
                      name="redis-bind"
                      aria-label="綁定位址"
                      value={
                        ['127.0.0.1', '0.0.0.0', '::1', '::'].includes(
                          String(settings.bind ?? '127.0.0.1'),
                        )
                          ? String(settings.bind ?? '127.0.0.1')
                          : '127.0.0.1'
                      }
                      onChange={(v) => patch('bind', v)}
                      options={[
                        { value: '127.0.0.1', label: '127.0.0.1' },
                        { value: '0.0.0.0', label: '0.0.0.0' },
                        { value: '::1', label: '::1' },
                        { value: '::', label: '::' },
                      ]}
                    />
                  </Field>
                  <Field
                    label="資料庫數量"
                    htmlFor="databases"
                    flush
                    hint="編號 0…N−1；改動後需套用並重啟"
                  >
                    <PresetChips
                      options={[
                        { value: '1', label: '1' },
                        { value: '4', label: '4' },
                        { value: '8', label: '8' },
                        { value: '16', label: '16' },
                        { value: '32', label: '32' },
                        { value: '64', label: '64' },
                      ]}
                      value={String(settings.databases ?? 16)}
                      onChange={(v) =>
                        patch('databases', Math.max(1, Math.min(256, Number(v) || 16)))
                      }
                      allowCustom
                      customPlaceholder="自訂 1–256"
                    />
                  </Field>
                  <Field label="記憶體上限" htmlFor="maxmemory" flush hint="0=不限">
                    <PresetChips
                      options={[
                        { value: '0', label: '不限' },
                        { value: '128mb', label: '128mb' },
                        { value: '256mb', label: '256mb' },
                        { value: '512mb', label: '512mb' },
                        { value: '1gb', label: '1gb' },
                        { value: '2gb', label: '2gb' },
                      ]}
                      value={String(settings.maxmemory ?? '0')}
                      onChange={(v) => patch('maxmemory', v)}
                      allowCustom
                      customPlaceholder="自訂，如 768mb"
                    />
                  </Field>
                  <Field label="淘汰策略" htmlFor="policy" flush>
                    <SegRadio
                      name="redis-policy"
                      aria-label="淘汰策略"
                      value={String(settings.maxmemoryPolicy ?? 'noeviction')}
                      onChange={(v) => patch('maxmemoryPolicy', v)}
                      options={[
                        { value: 'noeviction', label: 'noeviction' },
                        { value: 'allkeys-lru', label: 'allkeys-lru' },
                        { value: 'volatile-lru', label: 'volatile-lru' },
                        { value: 'allkeys-lfu', label: 'allkeys-lfu' },
                        { value: 'volatile-ttl', label: 'volatile-ttl' },
                      ]}
                    />
                  </Field>
                  <Field label="密碼" htmlFor="pass" flush hint="requirepass；可留空">
                    <input
                      id="pass"
                      type="password"
                      value={String(settings.requirepass ?? '')}
                      onChange={(e) => patch('requirepass', e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="閒置逾時（秒）" htmlFor="timeout" flush hint="0=不限">
                    <PresetChips
                      options={[
                        { value: '0', label: '不限' },
                        { value: '60', label: '60s' },
                        { value: '300', label: '5 分' },
                        { value: '900', label: '15 分' },
                        { value: '3600', label: '1 時' },
                      ]}
                      value={String(settings.timeout ?? 0)}
                      onChange={(v) => patch('timeout', Number(v) || 0)}
                      allowCustom
                      customPlaceholder="自訂秒數"
                    />
                  </Field>
                </FormLayout>
                <div className="form-check-row u-mt-4">
                  <CheckboxField
                    id="appendonly"
                    label="啟用 AOF"
                    description="appendonly 持久化"
                    checked={Boolean(settings.appendonly)}
                    onChange={(v) => patch('appendonly', v)}
                  />
                  <CheckboxField
                    id="protectedMode"
                    label="保護模式"
                    description="無密碼且非本機綁定時拒絕連線"
                    checked={settings.protectedMode !== false}
                    onChange={(v) => patch('protectedMode', v)}
                  />
                </div>
              </>
            ) : engine === 'postgres' ? (
              <FormLayout columns={2}>
                <Field label="埠" htmlFor="port" flush>
                  <PresetChips
                    options={[
                      { value: '5432', label: '5432' },
                      { value: '5433', label: '5433' },
                    ]}
                    value={String(settings.port ?? 5432)}
                    onChange={(v) => patch('port', Number(v) || 5432)}
                    allowCustom
                    customPlaceholder="自訂埠"
                  />
                </Field>
                <Field label="監聽位址" htmlFor="listen" flush hint="listen_addresses">
                  <SegRadio
                    name="pg-listen"
                    aria-label="監聽位址"
                    value={
                      ['localhost', '127.0.0.1', '*', '0.0.0.0'].includes(
                        String(settings.listenAddresses ?? 'localhost'),
                      )
                        ? String(settings.listenAddresses ?? 'localhost')
                        : 'localhost'
                    }
                    onChange={(v) => patch('listenAddresses', v)}
                    options={[
                      { value: 'localhost', label: 'localhost' },
                      { value: '127.0.0.1', label: '127.0.0.1' },
                      { value: '*', label: '*' },
                      { value: '0.0.0.0', label: '0.0.0.0' },
                    ]}
                  />
                </Field>
                <Field label="最大連線" htmlFor="mc" flush>
                  <PresetChips
                    options={[
                      { value: '50', label: '50' },
                      { value: '100', label: '100' },
                      { value: '200', label: '200' },
                      { value: '500', label: '500' },
                      { value: '1000', label: '1000' },
                    ]}
                    value={String(settings.maxConnections ?? 100)}
                    onChange={(v) => patch('maxConnections', Number(v) || 100)}
                    allowCustom
                    customPlaceholder="自訂"
                  />
                </Field>
              </FormLayout>
            ) : (
              <FormLayout columns={2}>
                <Field label="埠" htmlFor="port" flush>
                  <PresetChips
                    options={[
                      { value: '3306', label: '3306' },
                      { value: '3307', label: '3307' },
                    ]}
                    value={String(settings.port ?? 3306)}
                    onChange={(v) => patch('port', Number(v) || 3306)}
                    allowCustom
                    customPlaceholder="自訂埠"
                  />
                </Field>
                <Field label="綁定位址" htmlFor="bind" flush>
                  <SegRadio
                    name="mysql-bind"
                    aria-label="綁定位址"
                    value={
                      ['127.0.0.1', '0.0.0.0', '::'].includes(
                        String(settings.bindAddress ?? '127.0.0.1'),
                      )
                        ? String(settings.bindAddress ?? '127.0.0.1')
                        : '127.0.0.1'
                    }
                    onChange={(v) => patch('bindAddress', v)}
                    options={[
                      { value: '127.0.0.1', label: '127.0.0.1' },
                      { value: '0.0.0.0', label: '0.0.0.0' },
                      { value: '::', label: '::' },
                    ]}
                  />
                </Field>
                <Field label="最大連線" htmlFor="mc" flush>
                  <PresetChips
                    options={[
                      { value: '50', label: '50' },
                      { value: '100', label: '100' },
                      { value: '151', label: '151' },
                      { value: '300', label: '300' },
                      { value: '500', label: '500' },
                    ]}
                    value={String(settings.maxConnections ?? 151)}
                    onChange={(v) => patch('maxConnections', Number(v) || 151)}
                    allowCustom
                    customPlaceholder="自訂"
                  />
                </Field>
                <Field label="字元集" htmlFor="cs" flush hint="建議 utf8mb4">
                  <SegRadio
                    name="mysql-cs"
                    aria-label="字元集"
                    value={String(settings.characterSetServer ?? 'utf8mb4')}
                    onChange={(v) => patch('characterSetServer', v)}
                    options={[
                      { value: 'utf8mb4', label: 'utf8mb4' },
                      { value: 'utf8mb3', label: 'utf8mb3' },
                      { value: 'utf8', label: 'utf8' },
                      { value: 'latin1', label: 'latin1' },
                    ]}
                  />
                </Field>
              </FormLayout>
            )}

            <FormHint>儲存只更新面板設定；套用才寫入設定檔並重啟服務。</FormHint>
            <FormActions>
              <Button type="submit" variant="secondary" size="md" loading={busy}>
                儲存設定
              </Button>
              <Button type="button" variant="primary" size="md" loading={busy} onClick={() => void onApply()}>
                套用到系統並重啟
              </Button>
            </FormActions>
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
