/**
 * Production readiness — DescriptionList + Button standard.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  FeaturePageLayout,
  OpsResultPanel,
  SummaryStrip,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { humanizeOperatorNote, sanitizeOperatorNotes } from '../../shared/lib/operator-messages';

export function ReadinessPage() {
  const { busy, error, result, msg, run, setMsg } = useFeatureAction();
  const [facts, setFacts] = useState<Array<{ label: string; value: string }>>([]);
  const [ready, setReady] = useState<boolean | null>(null);

  return (
    <FeaturePageLayout
      title="生產就緒探測"
      subtitle="檢查此伺服器是否可作生產用途"
      showCapability={false}
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

      {ready != null ? (
        <SummaryStrip
          items={[
            {
              label: '可生產',
              value: ready ? '是' : '否',
              tone: ready ? 'ok' : 'warn',
            },
          ]}
        />
      ) : null}

      <Card>
        <CardSection title="就緒檢查" description="由管理面板探測主機能力">
          <Button
            variant="primary"
            size="md"
            loading={busy}
            onClick={() =>
              void run(async () => {
                const r = (await systemApi.readiness()) as Record<string, unknown>;
                const items: Array<{ label: string; value: string }> = [];
                if (r.productionReady != null) {
                  setReady(Boolean(r.productionReady));
                  items.push({
                    label: '可生產',
                    value: r.productionReady ? '是' : '否',
                  });
                }
                if (r.mode != null) {
                  const mode = String(r.mode);
                  items.push({
                    label: '模式',
                    value: mode === 'production_capable' ? '可生產' : mode,
                  });
                }
                if (r.score && typeof r.score === 'object') {
                  const s = r.score as { ready?: number; total?: number };
                  items.push({
                    label: '分數',
                    value: `${s.ready ?? '?'}/${s.total ?? '?'}`,
                  });
                }
                if (Array.isArray(r.summary)) {
                  for (const line of sanitizeOperatorNotes(r.summary.map(String))) {
                    items.push({
                      label: '摘要',
                      value: humanizeOperatorNote(line) ?? line,
                    });
                  }
                }
                setFacts(items);
                return {
                  ...r,
                  notes: Array.isArray(r.summary)
                    ? sanitizeOperatorNotes(r.summary.map(String))
                    : [],
                  ok: r.productionReady === true,
                } as OpsResultLike;
              }, '就緒檢查完成')
            }
          >
            執行就緒檢查
          </Button>
          {facts.length > 0 ? (
            <div className="u-mt-4">
              <DescriptionList
                columns={2}
                items={facts.map((f) =>
                  f.label === '可生產'
                    ? {
                        label: f.label,
                        value: (
                          <Badge tone={f.value === '是' ? 'ok' : 'warn'}>{f.value}</Badge>
                        ),
                      }
                    : f,
                )}
              />
            </div>
          ) : null}
        </CardSection>
      </Card>
      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
