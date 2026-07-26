/**
 * Firewall (UFW) — live status + panel apply (fail-closed).
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
  OpsResultPanel,
  SettingField,
  SettingFieldList,
  SoftwareInstallBanner,
  SummaryStrip,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';

export function FirewallPage() {
  const [allowSmtp, setAllowSmtp] = useState(true);
  const [extraPorts, setExtraPorts] = useState('21,30000:30100');
  const [status, setStatus] = useState<{
    installed: boolean;
    active: string;
    statusText: string;
    numberedRules: string[];
    executeEnabled: boolean;
    isRoot: boolean;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(await systemApi.firewallStatus());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '載入失敗');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function parsePorts(): number[] {
    const out: number[] = [];
    for (const part of extraPorts.split(/[,\s]+/).filter(Boolean)) {
      if (part.includes(':')) {
        const [a, b] = part.split(':').map(Number);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          for (let p = Math.min(a, b); p <= Math.max(a, b) && out.length < 40; p++) out.push(p);
        }
      } else {
        const n = Number(part);
        if (Number.isInteger(n) && n > 0 && n < 65536) out.push(n);
      }
    }
    return [...new Set(out)].slice(0, 40);
  }

  async function onApply() {
    await run(async () => {
      try {
        const r = await systemApi.firewallApply({
          allowSmtp,
          apply: true,
          extraTcpPorts: parsePorts(),
        });
        await refresh();
        return r as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : '套用失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, '已套用防火牆');
  }

  const active = status?.active === 'active';

  return (
    <FeaturePageLayout
      title="防火牆"
      subtitle="UFW 規則與即時狀態"
      actions={
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
      }
    >
      <SoftwareInstallBanner feature="firewall" title="UFW 尚未安裝" />
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
            label: 'UFW',
            value: status?.installed ? (active ? '啟用中' : status?.active ?? '—') : '未安裝',
            tone: active ? 'ok' : status?.installed ? 'warn' : 'danger',
          },
          {
            label: '規則列',
            value: String(status?.numberedRules?.length ?? 0),
          },
          {
            label: '系統變更',
            value: status?.executeEnabled ? '已開啟' : '未開啟',
            tone: status?.executeEnabled ? 'ok' : 'warn',
          },
          {
            label: '管理員',
            value: status?.isRoot ? '是' : '否',
            tone: status?.isRoot ? 'ok' : 'warn',
          },
        ]}
      />

      <Card>
        <CardSection title="服務概覽" description="即時探測（唯讀）">
          <DescriptionList
            columns={2}
            items={[
              {
                label: '狀態',
                value: (
                  <Badge tone={active ? 'ok' : status?.installed ? 'warn' : 'danger'}>
                    {status?.installed ? status.active : '未安裝'}
                  </Badge>
                ),
              },
              { label: '已安裝', value: status?.installed ? '是' : '否' },
              {
                label: '系統變更',
                value: status?.executeEnabled ? '已開啟' : '未開啟',
              },
              { label: '管理員', value: status?.isRoot ? '是' : '否' },
            ]}
          />
        </CardSection>
      </Card>

      <Card>
        <CardSection title="目前規則" description="來自 ufw status numbered">
          {status?.numberedRules?.length ? (
            <pre className="code code--spaced" style={{ maxHeight: 280, overflow: 'auto' }}>
              {status.numberedRules.join('\n')}
            </pre>
          ) : (
            <p className="muted u-text-sm" style={{ margin: 0 }}>
              {status?.installed ? '未讀到規則（可能未啟用或無權讀取）' : '請先安裝 UFW'}
            </p>
          )}
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title="套用規則集"
          description="寫入管理腳本並在有權限時執行 ufw（需系統變更 + root）"
        >
          <SettingFieldList>
            <SettingField
              label="允許 SMTP 相關埠"
              techKey="25/465/587/993"
              description="郵件出站／進站常用埠"
              htmlFor="fw-smtp"
            >
              <select
                id="fw-smtp"
                value={allowSmtp ? 'yes' : 'no'}
                onChange={(e) => setAllowSmtp(e.target.value === 'yes')}
              >
                <option value="yes">是</option>
                <option value="no">否</option>
              </select>
            </SettingField>
            <SettingField
              label="額外 TCP 埠"
              techKey="extra_tcp"
              description="逗號分隔；可用 30000:30100 範圍（最多 40 個）"
              htmlFor="fw-extra"
            >
              <input
                id="fw-extra"
                value={extraPorts}
                onChange={(e) => setExtraPorts(e.target.value)}
                placeholder="21, 30000:30100"
              />
            </SettingField>
          </SettingFieldList>
          <div className="setting-actions-bar">
            <Button variant="primary" size="md" loading={busy} onClick={() => void onApply()}>
              套用到系統
            </Button>
          </div>
          <p className="muted u-text-sm u-mt-2" style={{ marginBottom: 0 }}>
            預設會保留 SSH / 80 / 443。無權限時會明確失敗，不會假裝成功。
          </p>
        </CardSection>
      </Card>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
