/**
 * Shared runtime page — Node / PHP / Python / Go / Rust
 * Probe + version select + install (honest notes).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  OpsResultPanel,
  SoftwareInstallBanner,
  SummaryStrip,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';

export type HostingRuntimeKind = 'node' | 'php' | 'python' | 'go' | 'rust';

const META: Record<
  HostingRuntimeKind,
  {
    title: string;
    subtitle: string;
    defaultVersion: string;
    versions: string[];
    installLabel: (v: string) => string;
    bannerTitle: string;
  }
> = {
  node: {
    title: 'Node.js 執行環境',
    subtitle: '探測與安裝 Node 主版本',
    defaultVersion: '20',
    versions: ['18', '20', '22'],
    installLabel: (v) => `安裝 Node ${v}`,
    bannerTitle: 'Node.js 尚未安裝',
  },
  php: {
    title: 'PHP 執行環境',
    subtitle: 'PHP 版本、FPM 與探測',
    defaultVersion: '8.2',
    versions: ['8.1', '8.2', '8.3'],
    installLabel: (v) => `安裝 PHP ${v}`,
    bannerTitle: 'PHP 尚未安裝',
  },
  python: {
    title: 'Python 執行環境',
    subtitle: '探測與安裝 Python 3.x（venv 於專案部署時建立）',
    defaultVersion: '3.12',
    versions: ['3.10', '3.11', '3.12'],
    installLabel: (v) => `安裝 Python ${v}`,
    bannerTitle: 'Python 尚未安裝',
  },
  go: {
    title: 'Go 執行環境',
    subtitle: '探測與安裝 Go toolchain（官方 tarball）',
    defaultVersion: '1.22',
    versions: ['1.21', '1.22', '1.23'],
    installLabel: (v) => `安裝 Go ${v}`,
    bannerTitle: 'Go 尚未安裝',
  },
  rust: {
    title: 'Rust 執行環境',
    subtitle: '探測與安裝 rustup／cargo（寫入 /usr/local/ysk/rust）',
    defaultVersion: 'stable',
    versions: ['stable', '1.78', '1.81'],
    installLabel: (v) => `安裝 Rust ${v}`,
    bannerTitle: 'Rust／cargo 尚未安裝',
  },
};

export function GenericRuntimePage({ kind }: { kind: HostingRuntimeKind }) {
  const meta = META[kind];
  const [version, setVersion] = useState(meta.defaultVersion);
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
    setVersion(meta.defaultVersion);
    void refresh();
  }, [kind, meta.defaultVersion, refresh]);

  const probeData = useMemo(() => {
    const p = probe?.probe as Record<string, unknown> | undefined;
    const supported = probe?.supported as Record<string, string[]> | undefined;
    const items = (p?.[kind] as Array<Record<string, unknown>> | undefined) ?? [];
    const available = items.filter((i) => i.available).map((i) => String(i.version));
    const hostKey =
      kind === 'node'
        ? 'hostNode'
        : kind === 'php'
          ? 'hostPhp'
          : kind === 'python'
            ? 'hostPython'
            : kind === 'go'
              ? 'hostGo'
              : 'hostRust';
    return {
      items,
      available,
      host: p?.[hostKey] != null ? String(p[hostKey]) : '—',
      supported: supported?.[kind] ?? meta.versions,
      notes: Array.isArray(p?.notes) ? (p!.notes as string[]) : [],
    };
  }, [probe, kind, meta.versions]);

  return (
    <FeaturePageLayout
      title={meta.title}
      subtitle={meta.subtitle}
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
      <SoftwareInstallBanner feature={kind} title={meta.bannerTitle} />
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
            label: '主機探測',
            value: probe ? '已讀取' : '未探測',
            tone: probe ? 'ok' : 'default',
          },
          {
            label: '可用版本',
            value: probeData.available.length ? probeData.available.join(', ') : '無',
            tone: probeData.available.length ? 'ok' : 'warn',
          },
          { label: '目標版本', value: version },
        ]}
      />

      <Card>
        <CardSection title="探測結果" description="唯讀 · 安裝成功後請再探測確認">
          <DescriptionList
            columns={2}
            items={[
              { label: '主機預設', value: probeData.host },
              {
                label: '面板支援',
                value: probeData.supported.join(', '),
              },
              {
                label: '已就緒',
                value: probeData.available.length ? (
                  <span className="btn-row">
                    {probeData.available.map((v) => (
                      <Badge key={v} tone="ok">
                        {v}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  '尚未偵測到'
                ),
              },
            ]}
          />
          {probeData.items.length > 0 ? (
            <ul className="list-plain list-spaced u-mt-3">
              {probeData.items.map((i) => (
                <li key={String(i.version)}>
                  <strong>{String(i.version)}</strong>{' '}
                  <Badge tone={i.available ? 'ok' : 'neutral'}>
                    {i.available ? '可用' : '未找到'}
                  </Badge>
                  {i.resolvedPath ? (
                    <span className="muted u-text-sm"> · {String(i.resolvedPath)}</span>
                  ) : null}
                  {i.versionOutput ? (
                    <span className="muted u-text-sm"> · {String(i.versionOutput)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted u-mt-2">按「重新探測」載入主機版本矩陣</p>
          )}
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title="安裝"
          description="需系統變更權限與管理員；安裝 toolchain ≠ 專案已對外"
        >
          <FormLayout columns={2}>
            <Field label="目標版本" htmlFor={`rt-${kind}-ver`} flush required>
              <select
                id={`rt-${kind}-ver`}
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              >
                {(probeData.supported.length ? probeData.supported : meta.versions).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </FormLayout>
          <FormHint>
            寫入安裝腳本後，有權限才會真正執行。Go／Rust 建置在「部署專案」時進行。
          </FormHint>
          <FormActions>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const r = await systemApi.runtimeInstall({
                    kind,
                    version,
                    install: true,
                  });
                  await refresh();
                  return r as OpsResultLike;
                }, meta.installLabel(version))
              }
            >
              {meta.installLabel(version)}
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}

export function NodeRuntimePage() {
  return <GenericRuntimePage kind="node" />;
}

export function PhpRuntimePageSimple() {
  return <GenericRuntimePage kind="php" />;
}

export function PythonRuntimePage() {
  return <GenericRuntimePage kind="python" />;
}

export function GoRuntimePage() {
  return <GenericRuntimePage kind="go" />;
}

export function RustRuntimePage() {
  return <GenericRuntimePage kind="rust" />;
}
