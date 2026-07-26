/**
 * Node.js runtime — probe + install with standard UX.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardSection,
  DescriptionList,
  FeaturePageLayout,
  Field,
  OpsResultPanel,
  SoftwareInstallBanner,
  SummaryStrip,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';

export function NodeRuntimePage() {
  const [version, setVersion] = useState('20');
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    try {
      const r = (await systemApi.runtimes()) as Record<string, unknown>;
      setProbe(r);
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const nodePath = probe?.nodePath ?? probe?.node ?? probe?.['node.version'];
  const hasNode = Boolean(
    probe &&
      (probe.node ||
        probe.nodeVersion ||
        probe.nodePath ||
        (typeof probe.ok === 'boolean' && probe.ok)),
  );

  return (
    <FeaturePageLayout
      title="Node.js 執行環境"
      subtitle="探測與安裝 Node 主版本"
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
      <SoftwareInstallBanner feature="node" title="Node.js 尚未安裝" />
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
            label: '探測',
            value: probe ? '已讀取' : '未探測',
            tone: probe ? 'ok' : 'default',
          },
          { label: '目標版本', value: version },
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
            {nodePath != null ? (
              <p className="muted u-text-sm u-mt-2" style={{ marginBottom: 0 }}>
                參考：{String(nodePath)}
              </p>
            ) : null}
          </CardSection>
        </Card>
      ) : null}

      <Card>
        <CardSection title="安裝" description="需系統變更權限與管理員">
          <Field label="Node 主版本" techKey="version" htmlFor="node-ver">
            <select id="node-ver" value={version} onChange={(e) => setVersion(e.target.value)}>
              <option value="18">18</option>
              <option value="20">20</option>
              <option value="22">22</option>
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
                    kind: 'node',
                    version,
                    install: true,
                  });
                  await refresh();
                  return r as OpsResultLike;
                }, `已安裝 Node ${version}`)
              }
            >
              安裝 Node {version}
            </Button>
          </div>
          {hasNode ? (
            <p className="muted u-text-sm u-mt-2" style={{ marginBottom: 0 }}>
              主機上已偵測到 Node 相關資訊；重裝會依權限執行。
            </p>
          ) : null}
        </CardSection>
      </Card>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
