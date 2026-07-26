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
  CheckboxField,
  DescriptionList,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  OpsResultPanel,
  SoftwareInstallBanner,
  SummaryStrip,
  Tabs,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';

const FW_TABS = ['overview', 'rules', 'apply'] as const;

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
  const [tab, setTab] = usePageTab(FW_TABS, 'overview');

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

      <Tabs
        tabs={[
          { id: 'overview', label: '概覽' },
          {
            id: 'rules',
            label: '規則',
            badge: status?.numberedRules?.length || undefined,
          },
          { id: 'apply', label: '套用' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'overview' ? (
          <div className="tab-panel">
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
          </div>
        ) : null}

        {tab === 'rules' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title="目前規則" description="來自 ufw status numbered">
                {status?.numberedRules?.length ? (
                  <pre className="code code--spaced" style={{ maxHeight: 280, overflow: 'auto' }}>
                    {status.numberedRules.join('\n')}
                  </pre>
                ) : (
                  <p className="muted u-text-sm u-mb-0">
                    {status?.installed
                      ? '未讀到規則（可能未啟用或無權讀取）'
                      : '請先安裝 UFW'}
                  </p>
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'apply' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="套用規則集"
                description="寫入管理腳本並在有權限時執行 ufw（需系統變更 + root）"
              >
                <div className="form-check-row">
                  <CheckboxField
                    id="fw-smtp"
                    label="允許 SMTP 相關埠"
                    description="放行 25 / 465 / 587 / 993（郵件常用）"
                    checked={allowSmtp}
                    onChange={setAllowSmtp}
                  />
                </div>
                <FormLayout columns={2}>
                  <Field
                    label="額外 TCP 埠"
                    htmlFor="fw-extra"
                    fullWidth
                    flush
                    hint="逗號分隔；可用 30000:30100 範圍（最多 40 個）。預設含 FTPS 與 PASV"
                  >
                    <input
                      id="fw-extra"
                      value={extraPorts}
                      onChange={(e) => setExtraPorts(e.target.value)}
                      placeholder="21, 30000:30100"
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
                <FormHint>
                  預設會保留 SSH／80／443。無權限時會明確失敗，不會假裝成功。
                </FormHint>
                <FormActions>
                  <Button variant="primary" size="md" loading={busy} onClick={() => void onApply()}>
                    套用到系統
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
          </div>
        ) : null}
      </Tabs>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
