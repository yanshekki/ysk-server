/**
 * Public files nginx site — Form Kit + DescriptionList.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardSection,
  DescriptionList,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  OpsHero,
  OpsResultPanel,
  PresetChips,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { getServerContext, setServerContext } from '../../shared/stores/server-context';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { Link } from 'react-router-dom';

export function PublicFilesPage() {
  const ctx = getServerContext();
  const [serverName, setServerName] = useState(`files.${ctx.domain}`);
  const [quotaMb, setQuotaMb] = useState('1024');
  const { busy, error, result, msg, run, setMsg } = useFeatureAction();

  return (
    <FeaturePageLayout
      title="公用檔案伺服器"
      subtitle="Nginx 公開檔案站點"
      showCapability={false}
      actions={
        <Link to="/files" className="btn btn--ghost btn--md">
          檔案管理
        </Link>
      }
    >
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
        eyebrow="Public files"
        title="公開檔案站點"
        pill={serverName || '未設定'}
        pillTone={serverName ? 'ok' : 'warn'}
        tone="ok"
        hint="寫入管理 conf；套用時可嘗試 reload Nginx。written ≠ 對外可連。"
        stats={[
          { label: 'server_name', value: <span className="ops-stat__val--sm">{serverName || '—'}</span> },
          { label: '配額', value: `${quotaMb || '—'} MiB` },
          { label: 'Reload', value: '套用時' },
          { label: '路徑', value: 'dataDir/files' },
        ]}
        cta={
          <Link to="/nginx" className="btn btn--secondary btn--md">
            Nginx
          </Link>
        }
      />

      <Card>
        <CardSection title="概覽" description="即將套用的設定（唯讀摘要）">
          <DescriptionList
            columns={2}
            items={[
              { label: '伺服器名稱', value: serverName || '—' },
              { label: '配額', value: `${quotaMb || '—'} MiB` },
              { label: '重載 Nginx', value: '套用時嘗試' },
            ]}
          />
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title="站點設定"
          description="寫入管理 conf；套用時可嘗試 reload Nginx（written ≠ 對外可連）"
        >
          <FormLayout columns={2}>
            <Field
              label="伺服器名稱"
              htmlFor="pf-sn"
              flush
              required
              hint="Nginx server_name，例如 files.example.com"
            >
              <input
                id="pf-sn"
                value={serverName}
                onChange={(e) => {
                  setServerName(e.target.value);
                  setServerContext({ domain: e.target.value.replace(/^files\./, '') });
                }}
                placeholder="files.example.com"
                spellCheck={false}
              />
            </Field>
            <Field
              label="配額（MiB）"
              htmlFor="pf-q"
              flush
              hint="可選；限制公開目錄總量"
            >
              <PresetChips
                options={[
                  { value: '', label: '不限' },
                  { value: '512', label: '512' },
                  { value: '1024', label: '1G' },
                  { value: '5120', label: '5G' },
                  { value: '10240', label: '10G' },
                  { value: '51200', label: '50G' },
                ]}
                value={quotaMb}
                onChange={setQuotaMb}
                allowCustom
                customPlaceholder="MiB"
              />
            </Field>
          </FormLayout>
          <FormHint>
            套用成功只代表設定已寫入；DNS、SSL 與防火牆需另行就緒才會對外服務。
          </FormHint>
          <FormActions>
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
          </FormActions>
        </CardSection>
      </Card>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
