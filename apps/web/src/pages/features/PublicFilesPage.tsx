/**
 * Public files nginx site — SettingField + DescriptionList pattern.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardSection,
  DescriptionList,
  FeaturePageLayout,
  OpsResultPanel,
  SettingField,
  SettingFieldList,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { getServerContext, setServerContext } from '../../shared/stores/server-context';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';

export function PublicFilesPage() {
  const ctx = getServerContext();
  const [serverName, setServerName] = useState(`files.${ctx.domain}`);
  const [quotaMb, setQuotaMb] = useState('1024');
  const { busy, error, result, msg, run, setMsg } = useFeatureAction();

  return (
    <FeaturePageLayout title="公用檔案伺服器" subtitle="Nginx 公開檔案站點">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      <Card>
        <CardSection title="概覽" description="即將套用的設定（唯讀摘要）">
          <DescriptionList
            columns={2}
            items={[
              { label: 'Server name', value: serverName || '—' },
              { label: 'Quota', value: `${quotaMb || '—'} MiB` },
              { label: '重載 Nginx', value: '套用時嘗試' },
            ]}
          />
        </CardSection>
      </Card>

      <Card>
        <CardSection title="站點設定" description="寫入管理 conf 並可重載 Nginx">
          <SettingFieldList>
            <SettingField label="伺服器名稱" techKey="server_name" htmlFor="pf-sn">
              <input
                id="pf-sn"
                value={serverName}
                onChange={(e) => {
                  setServerName(e.target.value);
                  setServerContext({ domain: e.target.value.replace(/^files\./, '') });
                }}
              />
            </SettingField>
            <SettingField label="配額" techKey="quota_mb" description="MiB，可選" htmlFor="pf-q">
              <input id="pf-q" value={quotaMb} onChange={(e) => setQuotaMb(e.target.value)} />
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
                    return (await systemApi.publicFilesApply({
                      serverName,
                      quotaMb: Number(quotaMb) || undefined,
                      reload: true,
                    })) as OpsResultLike;
                  } catch (e) {
                    const m = e instanceof Error ? e.message : '套用失敗';
                    return { ok: false, blocked: true, blockMessage: m, notes: [m] };
                  }
                }, '已套用公開檔案站點')
              }
            >
              套用並重載 Nginx
            </Button>
          </div>
        </CardSection>
      </Card>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
