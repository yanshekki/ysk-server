/**
 * Control-plane systemd unit — professional ops console (honest write vs enable).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  FeaturePageLayout,
  LoadingBlock,
  OpsResultPanel,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';

type SystemdStatus = {
  unit: string;
  unitPathHint: string;
  active: string;
  enabled: string;
  executeEnabled: boolean;
  isRoot: boolean;
  canInstall?: boolean;
  systemUnitExists?: boolean;
  managedUnitPath?: string | null;
  managedUnitExists?: boolean;
  show?: {
    mainPid: string | null;
    activeEnterTimestamp: string | null;
    fragmentPath: string | null;
    description: string | null;
  };
};

function enabledLabel(v?: string): string {
  if (!v) return '—';
  if (v === 'enabled') return '已啟用';
  if (v === 'disabled') return '未啟用';
  if (v === 'not-found') return '未安裝';
  if (v === 'static') return 'static';
  if (v === 'indirect') return 'indirect';
  return v;
}

function activeTone(active: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (active === 'active') return 'ok';
  if (active === 'activating' || active === 'reloading') return 'warn';
  if (active === 'failed') return 'danger';
  if (active === 'inactive' || active === 'not-found') return 'warn';
  return 'neutral';
}

function activeLabel(active: string): string {
  if (active === 'active') return '運行中';
  if (active === 'inactive') return '未運行';
  if (active === 'failed') return '失敗';
  if (active === 'activating') return '啟動中';
  if (active === 'not-found') return '單元不存在';
  return active || '—';
}

function enabledTone(v?: string): 'ok' | 'warn' | 'neutral' {
  if (v === 'enabled') return 'ok';
  if (v === 'disabled' || v === 'not-found') return 'warn';
  return 'neutral';
}

export function SystemdUnitPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SystemdStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
    void refresh().finally(() => setLoading(false));
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
  const canInstall =
    status?.canInstall ??
    Boolean(status?.executeEnabled && status?.isRoot);

  const heroTone = useMemo(() => {
    if (!status) return 'neutral';
    if (running && status.enabled === 'enabled') return 'ok';
    if (active === 'failed') return 'danger';
    if (!canInstall) return 'warn';
    return 'warn';
  }, [status, running, active, canInstall]);

  const nextSteps = useMemo(() => {
    if (!status) return [];
    const steps: Array<{
      id: string;
      title: string;
      detail: string;
      href?: string;
      action?: 'template' | 'install';
      done?: boolean;
    }> = [];

    if (!status.managedUnitExists) {
      steps.push({
        id: 'template',
        title: '寫入管理目錄範本',
        detail: '於 dataDir/systemd 產生 ysk-server.service（唔會改 /etc）',
        action: 'template',
        done: false,
      });
    } else {
      steps.push({
        id: 'template',
        title: '管理目錄範本已存在',
        detail: status.managedUnitPath ?? 'dataDir/systemd/ysk-server.service',
        done: true,
      });
    }

    if (!status.systemUnitExists || status.enabled === 'not-found') {
      steps.push({
        id: 'install',
        title: '安裝到 /etc/systemd 並啟用',
        detail: canInstall
          ? '複製 unit → daemon-reload → enable --now'
          : '需 YSK_EXECUTE=1 與 root；否則會誠實失敗',
        action: 'install',
        done: false,
      });
    } else if (!running) {
      steps.push({
        id: 'start',
        title: '服務未運行',
        detail: 'unit 可能已安裝但 inactive — 可再「安裝並啟用」或於服務矩陣操作',
        action: 'install',
        href: '/services',
        done: false,
      });
    } else {
      steps.push({
        id: 'running',
        title: '控制面服務運行中',
        detail: status.show?.mainPid
          ? `MainPID ${status.show.mainPid}`
          : 'systemctl is-active: active',
        done: true,
      });
    }

    if (!canInstall) {
      steps.push({
        id: 'caps',
        title: '解鎖系統套用能力',
        detail: '以 root 啟動並設定 YSK_EXECUTE=1',
        href: '/system',
        done: false,
      });
    }

    return steps;
  }, [status, canInstall, running]);

  return (
    <FeaturePageLayout
      title={t('nav.systemd', { defaultValue: 'systemd' })}
      showCapability={false}
      actions={
        <>
          <Button
            variant="secondary"
            size="md"
            loading={busy || loading}
            onClick={() => {
              setError(null);
              setMsg(null);
              setLoading(true);
              void refresh().finally(() => setLoading(false));
            }}
          >
            重新整理
          </Button>
          <Link to="/services" className="btn btn--ghost btn--md">
            服務矩陣
          </Link>
          <Link to="/system" className="btn btn--ghost btn--md">
            主機設定
          </Link>
        </>
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

      {loading && !status ? (
        <LoadingBlock label="探測 systemd 狀態…" />
      ) : status ? (
        <div className="sdu">
          {/* Hero */}
          <section className={`sdu-hero sdu-hero--${heroTone}`} aria-label="單元總覽">
            <div className="sdu-hero__main">
              <div className="sdu-hero__identity">
                <div className="sdu-hero__eyebrow">Control-plane unit</div>
                <h2 className="sdu-hero__title">
                  <span className={`sdu-hero__pill sdu-hero__pill--${activeTone(active)}`}>
                    {activeLabel(active)}
                  </span>
                  <code className="sdu-hero__unit">{status.unit}.service</code>
                </h2>
                <p className="sdu-hero__hint">
                  {status.show?.description ||
                    'YSK 控制面 API／排程進程。寫入 dataDir 範本 ≠ /etc 已安裝 ≠ 已在跑。'}
                </p>
                <div className="sdu-hero__meta">
                  <span>
                    開機自啟{' '}
                    <strong>{enabledLabel(status.enabled)}</strong>
                  </span>
                  <span className="sdu-hero__dot" />
                  <span>
                    系統 unit{' '}
                    <strong>
                      {status.systemUnitExists === false
                        ? '不存在'
                        : status.systemUnitExists
                          ? '存在'
                          : '—'}
                    </strong>
                  </span>
                  {status.show?.mainPid ? (
                    <>
                      <span className="sdu-hero__dot" />
                      <span>
                        PID <strong>{status.show.mainPid}</strong>
                      </span>
                    </>
                  ) : null}
                </div>
                <div className="sdu-hero__cta">
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    disabled={!canInstall}
                    onClick={() => void doInstall(true)}
                    title={
                      canInstall
                        ? '複製到 /etc/systemd 並 enable --now'
                        : '需要 EXECUTE + root'
                    }
                  >
                    安裝並啟用
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() => void doInstall(false)}
                  >
                    僅寫入範本
                  </Button>
                  <Link to="/system/readiness" className="btn btn--ghost btn--md">
                    就緒探測
                  </Link>
                </div>
              </div>

              <div className="sdu-hero__cards" aria-label="能力">
                <div className="sdu-card">
                  <span className="sdu-card__lab">狀態</span>
                  <Badge tone={activeTone(active)}>{activeLabel(active)}</Badge>
                  <span className="sdu-card__raw">{active}</span>
                </div>
                <div className="sdu-card">
                  <span className="sdu-card__lab">開機自啟</span>
                  <Badge tone={enabledTone(status.enabled)}>
                    {enabledLabel(status.enabled)}
                  </Badge>
                  <span className="sdu-card__raw">{status.enabled}</span>
                </div>
                <div className="sdu-card">
                  <span className="sdu-card__lab">EXECUTE</span>
                  <Badge tone={status.executeEnabled ? 'ok' : 'warn'}>
                    {status.executeEnabled ? '開' : '關'}
                  </Badge>
                </div>
                <div className="sdu-card">
                  <span className="sdu-card__lab">Root</span>
                  <Badge tone={status.isRoot ? 'ok' : 'warn'}>
                    {status.isRoot ? '是' : '否'}
                  </Badge>
                </div>
              </div>
            </div>

            <ul className="sdu-rail" aria-label="路徑與能力">
              <li>
                <span className="sdu-rail__k">系統路徑</span>
                <code className="sdu-rail__code">
                  {status.show?.fragmentPath || status.unitPathHint}
                </code>
              </li>
              <li>
                <span className="sdu-rail__k">管理範本</span>
                <code className="sdu-rail__code">
                  {status.managedUnitPath ?? 'dataDir/systemd/…'}
                </code>
                <Badge tone={status.managedUnitExists ? 'ok' : 'neutral'}>
                  {status.managedUnitExists ? '有' : '無'}
                </Badge>
              </li>
              <li>
                <span className="sdu-rail__k">可安裝</span>
                <Badge tone={canInstall ? 'ok' : 'warn'}>
                  {canInstall ? '是' : '否'}
                </Badge>
              </li>
              {status.show?.activeEnterTimestamp ? (
                <li>
                  <span className="sdu-rail__k">啟動時間</span>
                  <span className="sdu-rail__text">
                    {status.show.activeEnterTimestamp}
                  </span>
                </li>
              ) : null}
            </ul>
          </section>

          <div className="sdu-grid">
            {/* Next steps */}
            <section className="sdu-panel sdu-panel--primary">
              <header className="sdu-panel__head">
                <div>
                  <h3 className="sdu-panel__title">建議步驟</h3>
                  <p className="sdu-panel__sub">
                    按順序處理；每步會誠實回報 blocked／失敗
                  </p>
                </div>
              </header>
              <ol className="sdu-steps">
                {nextSteps.map((s, i) => (
                  <li
                    key={s.id}
                    className={`sdu-step${s.done ? ' sdu-step--done' : ''}`}
                  >
                    <span className="sdu-step__num" aria-hidden>
                      {s.done ? '✓' : i + 1}
                    </span>
                    <div className="sdu-step__body">
                      <div className="sdu-step__title">{s.title}</div>
                      <div className="sdu-step__detail">{s.detail}</div>
                    </div>
                    <div className="sdu-step__action">
                      {s.done ? (
                        <span className="sdu-step__ok">完成</span>
                      ) : s.action === 'template' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busy}
                          onClick={() => void doInstall(false)}
                        >
                          寫入
                        </Button>
                      ) : s.action === 'install' ? (
                        <Button
                          variant="primary"
                          size="sm"
                          loading={busy}
                          disabled={!canInstall && s.id === 'install'}
                          onClick={() => void doInstall(true)}
                        >
                          安裝啟用
                        </Button>
                      ) : s.href ? (
                        <Link to={s.href} className="btn btn--ghost btn--sm">
                          前往
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
              {!canInstall ? (
                <div className="sdu-callout sdu-callout--warn">
                  目前無法真正安裝到系統：需要{' '}
                  <code>YSK_EXECUTE=1</code> 與 root。
                  「僅寫入範本」仍可產生管理目錄檔案。見{' '}
                  <Link to="/system">主機設定</Link> /{' '}
                  <Link to="/system/readiness">就緒探測</Link>。
                </div>
              ) : null}
            </section>

            {/* Facts + honest policy */}
            <aside className="sdu-side">
              <section className="sdu-panel">
                <header className="sdu-panel__head">
                  <h3 className="sdu-panel__title">探測詳情</h3>
                </header>
                <dl className="sdu-dl">
                  <div>
                    <dt>單元</dt>
                    <dd>
                      <code>{status.unit}.service</code>
                    </dd>
                  </div>
                  <div>
                    <dt>is-active</dt>
                    <dd>
                      <Badge tone={activeTone(active)}>{active}</Badge>
                    </dd>
                  </div>
                  <div>
                    <dt>is-enabled</dt>
                    <dd>
                      <Badge tone={enabledTone(status.enabled)}>
                        {status.enabled}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt>系統檔</dt>
                    <dd>
                      {status.systemUnitExists ? '存在' : '不存在'} ·{' '}
                      <code className="sdu-dl__path">{status.unitPathHint}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>管理範本</dt>
                    <dd>
                      {status.managedUnitExists ? '存在' : '尚未寫入'}
                      {status.managedUnitPath ? (
                        <>
                          <br />
                          <code className="sdu-dl__path">
                            {status.managedUnitPath}
                          </code>
                        </>
                      ) : null}
                    </dd>
                  </div>
                  {status.show?.fragmentPath ? (
                    <div>
                      <dt>Fragment</dt>
                      <dd>
                        <code className="sdu-dl__path">
                          {status.show.fragmentPath}
                        </code>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              <section className="sdu-panel">
                <header className="sdu-panel__head">
                  <h3 className="sdu-panel__title">誠實政策</h3>
                </header>
                <ul className="sdu-bullets">
                  <li>
                    <strong>僅寫入範本</strong> — 只寫 dataDir，唔動 /etc
                  </li>
                  <li>
                    <strong>安裝並啟用</strong> — cp + daemon-reload + enable
                    --now
                  </li>
                  <li>未開 EXECUTE 或非 root → 明確 blocked，唔假成功</li>
                  <li>寫入範本 ≠ 服務已啟用 ≠ 已在監聽端口</li>
                </ul>
              </section>

              <nav className="sdu-shortcuts" aria-label="相關">
                <Link to="/system" className="sdu-shortcut">
                  <span className="sdu-shortcut__t">主機設定</span>
                  <span className="sdu-shortcut__d">EXECUTE / 電源</span>
                </Link>
                <Link to="/services" className="sdu-shortcut">
                  <span className="sdu-shortcut__t">服務矩陣</span>
                  <span className="sdu-shortcut__d">其他 unit</span>
                </Link>
                <Link to="/system/readiness" className="sdu-shortcut">
                  <span className="sdu-shortcut__t">就緒探測</span>
                  <span className="sdu-shortcut__d">生產閘門</span>
                </Link>
                <Link to="/logs" className="sdu-shortcut">
                  <span className="sdu-shortcut__t">日誌中心</span>
                  <span className="sdu-shortcut__d">journal</span>
                </Link>
              </nav>
            </aside>
          </div>

          {/* Actions panel */}
          <section className="sdu-panel">
            <header className="sdu-panel__head">
              <div>
                <h3 className="sdu-panel__title">安裝操作</h3>
                <p className="sdu-panel__sub">
                  兩種模式用途不同 — 請按環境選擇
                </p>
              </div>
            </header>
            <div className="sdu-actions">
              <article className="sdu-action-card">
                <h4 className="sdu-action-card__title">僅寫入範本</h4>
                <p className="sdu-action-card__body">
                  產生管理目錄 unit 檔。適合先檢視內容、或無 root 時預先準備。
                  <strong>唔會</strong> enable 服務。
                </p>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() => void doInstall(false)}
                >
                  寫入範本
                </Button>
              </article>
              <article className="sdu-action-card sdu-action-card--primary">
                <h4 className="sdu-action-card__title">安裝並啟用</h4>
                <p className="sdu-action-card__body">
                  複製到 <code>/etc/systemd/system</code>、daemon-reload、
                  <code>enable --now</code>。需 root + EXECUTE。
                </p>
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  disabled={!canInstall}
                  onClick={() => void doInstall(true)}
                >
                  安裝並啟用
                </Button>
              </article>
            </div>
          </section>

          <OpsResultPanel
            title="操作結果"
            result={result}
            message={msg}
            busy={busy}
          />
        </div>
      ) : null}
    </FeaturePageLayout>
  );
}
