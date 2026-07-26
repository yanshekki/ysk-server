/**
 * Control-plane systemd unit — honest write vs enable.
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
  FormActions,
  FormHint,
  OpsResultPanel,
  SummaryStrip,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';

function enabledLabel(v?: string): string {
  if (!v) return '—';
  if (v === 'enabled') return '是';
  if (v === 'disabled') return '否';
  return v;
}

export function SystemdUnitPage() {
  const [status, setStatus] = useState<{
    unit: string;
    unitPathHint: string;
    active: string;
    enabled: string;
    executeEnabled: boolean;
    isRoot: boolean;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(await systemApi.systemdStatus());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '載入失敗');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function doInstall(enable: boolean) {
    await run(async () => {
      try {
        const r = await systemApi.systemdInstall({ enable });
        await refresh();
        return r as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : '操作失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, enable ? '已安裝並嘗試啟用' : '已寫入 unit 範本');
  }

  const active = status?.active ?? '—';
  const running = active === 'active';

  return (
    <FeaturePageLayout
      title="systemd 單元"
      subtitle="控制面 ysk-server.service"
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
            value: running ? '運行中' : active,
            tone: running ? 'ok' : 'warn',
          },
          { label: '開機自啟', value: enabledLabel(status?.enabled) },
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
        <CardSection title="服務概覽" description="唯讀探測">
          <DescriptionList
            columns={2}
            items={[
              {
                label: '狀態',
                value: (
                  <Badge tone={running ? 'ok' : 'warn'}>{running ? '運行中' : active}</Badge>
                ),
              },
              { label: '單元名稱', value: status?.unit ?? 'ysk-server' },
              { label: '開機自啟', value: enabledLabel(status?.enabled) },
              { label: '系統路徑', value: status?.unitPathHint ?? '—' },
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
        <CardSection
          title="安裝／啟用"
          description="「僅寫入」只產生管理目錄範本；「安裝並啟用」才會複製到 /etc/systemd 並啟用"
        >
          <FormHint>
            寫入範本 ≠ 服務已啟用。未開系統變更或非 root 時，安裝並啟用會明確失敗，不會假裝成功。
          </FormHint>
          <FormActions>
            <Button variant="secondary" size="md" loading={busy} onClick={() => void doInstall(false)}>
              僅寫入範本
            </Button>
            <Button variant="primary" size="md" loading={busy} onClick={() => void doInstall(true)}>
              安裝並啟用
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
