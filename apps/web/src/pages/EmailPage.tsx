/**
 * Email control plane — SOC-style hub:
 * domains · queue · software stack · ops notes.
 * Create only in page header actions.
 */
import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { emailApi, useEmailDomains } from '../features/email';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  KpiCard,
  KpiGrid,
  Modal,
  SoftwareInstallBanner,
  Tabs,
} from '../shared/components/ui';
import { getServerContext, setServerContext } from '../shared/stores/server-context';
import { usePageTab } from '../shared/hooks/usePageTab';

const TABS = ['domains', 'queue', 'stack', 'ops'] as const;

function applyLabel(status?: string): { text: string; tone: 'ok' | 'info' | 'neutral' | 'warn' } {
  const s = (status ?? 'draft').toLowerCase();
  if (s === 'applied') return { text: '已套用', tone: 'ok' };
  if (s === 'written') return { text: '已寫入', tone: 'info' };
  if (s === 'failed') return { text: '失敗', tone: 'warn' };
  return { text: '草稿', tone: 'neutral' };
}

export function EmailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ctx = getServerContext();
  const { items, error, setError, busy, create, refresh } = useEmailDomains();
  const [tab, setTab] = usePageTab(TABS, 'domains');
  const [createOpen, setCreateOpen] = useState(false);
  const [domain, setDomain] = useState('');
  const [serverIp, setServerIp] = useState(ctx.serverIp);
  const [query, setQuery] = useState('');
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [queueOk, setQueueOk] = useState<boolean | null>(null);
  const [queueItems, setQueueItems] = useState<Array<{ id: string; raw: string }>>([]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((d) => d.domain.toLowerCase().includes(q));
  }, [items, query]);

  const applied = items.filter((d) => (d.apply_status ?? '').toLowerCase() === 'applied').length;
  const healthy = items.filter((d) => d.health_score >= 80).length;
  const draft = items.filter((d) => {
    const s = (d.apply_status ?? 'draft').toLowerCase();
    return s === 'draft' || s === 'written' || !d.apply_status;
  }).length;

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await create({ domain, serverIp });
      setDomain('');
      setCreateOpen(false);
      setServerContext({ domain, serverIp });
      const domainName =
        typeof created.domain === 'string' ? created.domain : created.domain.domain;
      const list = await refresh();
      const found =
        list.find((x) => x.domain === domainName) ??
        (typeof created.domain === 'object' ? created.domain : null);
      if (found?.id) navigate(`/email/domains/${found.id}`);
    } catch {
      /* hook sets error */
    }
  }

  async function loadQueue() {
    setQueueBusy(true);
    setQueueMsg(null);
    try {
      const r = await emailApi.mailQueue();
      setQueueItems(r.items ?? []);
      setQueueOk(r.ok !== false && !r.blocked);
      setQueueMsg((r.notes ?? []).join(' · ') || `佇列 ${(r.items ?? []).length} 封`);
    } catch (e) {
      setQueueOk(false);
      setQueueMsg(e instanceof Error ? e.message : '讀取佇列失敗');
      setQueueItems([]);
    } finally {
      setQueueBusy(false);
    }
  }

  async function flushAll() {
    if (!window.confirm('確定清空全部郵件佇列？此操作不可復原。')) return;
    setQueueBusy(true);
    try {
      const r = await emailApi.flushQueue({ all: true });
      setQueueItems([]);
      setQueueOk(r.ok !== false && !(r as { blocked?: boolean }).blocked);
      setQueueMsg(
        ((r as { notes?: string[] }).notes ?? []).join(' · ') || '已請求清空佇列',
      );
    } catch (e) {
      setQueueOk(false);
      setQueueMsg(e instanceof Error ? e.message : '清空失敗');
    } finally {
      setQueueBusy(false);
    }
  }

  async function flushOne(id: string) {
    setQueueBusy(true);
    try {
      const r = await emailApi.flushQueue({ id });
      setQueueMsg(((r as { notes?: string[] }).notes ?? []).join(' · ') || `已刪 ${id}`);
      setQueueOk(r.ok !== false);
      setQueueItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setQueueOk(false);
      setQueueMsg(e instanceof Error ? e.message : '刪除失敗');
    } finally {
      setQueueBusy(false);
    }
  }

  return (
    <FeaturePageLayout
      title={t('email.title')}
      subtitle="控制面登記 · 本機 MTA · 誠實權限（written ≠ 可收發）"
      actions={
        <div className="btn-row">
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => void refresh().catch((e: Error) => setError(e.message))}
          >
            重新整理
          </Button>
          <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
            + {t('email.create')}
          </Button>
        </div>
      }
    >
      {/* Hero */}
      <section className="mail-hero" aria-label="郵件總覽">
        <div className="mail-hero__main">
          <div className="mail-hero__eyebrow">Mail Control Plane</div>
          <h2 className="mail-hero__title">
            郵件伺服器
            <Badge tone={items.length > 0 ? 'ok' : 'neutral'}>
              {items.length} 域名
            </Badge>
            {applied > 0 ? (
              <Badge tone="ok">{applied} 已套用</Badge>
            ) : (
              <Badge tone="warn">尚未套用系統</Badge>
            )}
          </h2>
          <p className="mail-hero__hint">
            本頁管理域名登記與本機佇列。真正安裝 Postfix／Dovecot／Webmail、DNS
            與 SSL 請進入域名詳情「一鍵設定郵件」。
          </p>
        </div>
        <KpiGrid cols={4} className="mail-hero__kpis">
          <KpiCard label="已登記域名">
            <span className="mail-kpi-value">{items.length}</span>
            <span className="mail-kpi-sub">控制面列表</span>
          </KpiCard>
          <KpiCard
            label="健康 ≥80"
            badge={
              healthy > 0
                ? { label: 'OK', tone: 'ok' }
                : { label: '—', tone: 'neutral' }
            }
          >
            <span className="mail-kpi-value">{healthy}</span>
            <span className="mail-kpi-sub">health score</span>
          </KpiCard>
          <KpiCard
            label="已套用系統"
            badge={
              applied > 0
                ? { label: 'applied', tone: 'ok' }
                : { label: 'draft', tone: 'warn' }
            }
          >
            <span className="mail-kpi-value">{applied}</span>
            <span className="mail-kpi-sub">apply_status</span>
          </KpiCard>
          <KpiCard label="草稿／寫入">
            <span className="mail-kpi-value">{draft}</span>
            <span className="mail-kpi-sub">尚未 applied</span>
          </KpiCard>
        </KpiGrid>
      </section>

      <SoftwareInstallBanner feature="email" title="郵件所需軟件尚未安裝" />
      {error ? <Alert variant="error">{error}</Alert> : null}

      <Tabs
        tabs={[
          {
            id: 'domains',
            label: '域名',
            badge: items.length || undefined,
          },
          {
            id: 'queue',
            label: '佇列',
            badge: queueItems.length || undefined,
          },
          { id: 'stack', label: '軟件' },
          { id: 'ops', label: '分工' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'domains' ? (
          <div className="tab-panel mail-panel">
            <div className="mail-toolbar">
              <div className="page-toolbar__search mail-toolbar__search">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('email.searchPlaceholder')}
                  aria-label={t('email.searchPlaceholder')}
                />
              </div>
              <span className="muted u-text-sm">
                顯示 {filtered.length} / {items.length}
              </span>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                title={t('email.empty')}
                description={
                  items.length === 0
                    ? '用右上角「建立郵件域名」登記；成功後進入詳情完成一鍵設定與 DNS。'
                    : '沒有符合搜尋的域名'
                }
              />
            ) : (
              <div className="list-panel mail-domain-list" role="list">
                {filtered.map((d) => {
                  const st = applyLabel(d.apply_status);
                  return (
                    <Link
                      key={d.id}
                      to={`/email/domains/${d.id}`}
                      className="list-row mail-domain-row"
                    >
                      <div className="list-row__main">
                        <div className="list-row__title">
                          <span className="mail-domain-name">{d.domain}</span>
                          <Badge tone={st.tone}>{st.text}</Badge>
                        </div>
                        <div className="list-row__meta">
                          <span>IP {d.server_ip || '—'}</span>
                        </div>
                      </div>
                      <div className="list-row__side">
                        <Badge tone={d.health_score >= 80 ? 'ok' : 'warn'}>
                          {d.health_score}/100
                        </Badge>
                        <span className="list-row__chevron" aria-hidden>
                          ›
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {tab === 'queue' ? (
          <div className="tab-panel mail-panel">
            <div className="mail-card">
              <div className="mail-card__head">
                <div>
                  <h3 className="mail-card__title">本機郵件佇列</h3>
                  <p className="mail-card__desc muted u-text-sm">
                    postqueue / postsuper · 需 YSK_EXECUTE · 未安裝 MTA 會誠實失敗
                  </p>
                </div>
                <div className="btn-row">
                  <Button
                    variant="secondary"
                    size="md"
                    loading={queueBusy}
                    onClick={() => void loadQueue()}
                  >
                    查看佇列
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    loading={queueBusy}
                    onClick={() => void flushAll()}
                  >
                    清空佇列
                  </Button>
                </div>
              </div>

              {queueMsg ? (
                <Alert
                  variant={
                    queueOk === false
                      ? 'error'
                      : queueOk === true
                        ? 'ok'
                        : 'info'
                  }
                >
                  {queueMsg}
                </Alert>
              ) : (
                <Alert variant="info">
                  按「查看佇列」讀取本機 Postfix 佇列。無 EXECUTE 或無 postqueue 時會顯示失敗原因。
                </Alert>
              )}

              {queueItems.length > 0 ? (
                <ul className="mail-queue-list">
                  {queueItems.slice(0, 50).map((it) => (
                    <li key={it.id}>
                      <code className="mail-queue-list__raw">{it.raw}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={queueBusy}
                        onClick={() => void flushOne(it.id)}
                      >
                        刪除此 ID
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : queueOk === true ? (
                <EmptyState title="佇列為空" description="目前沒有待送郵件" />
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === 'stack' ? (
          <div className="tab-panel mail-panel">
            <div className="mail-ops-grid">
              <div className="mail-card">
                <div className="mail-card__head">
                  <h3 className="mail-card__title">MTA 軟件</h3>
                </div>
                <p className="muted u-text-sm">
                  探測與一鍵安裝由上方橫幅驅動。列表頁<strong>不</strong>假裝已安裝。
                </p>
                <ul className="mail-stack-list">
                  <li>
                    <strong>Postfix</strong>
                    <span className="muted">SMTP 出站／入站</span>
                  </li>
                  <li>
                    <strong>Dovecot</strong>
                    <span className="muted">IMAP／POP3 信箱</span>
                  </li>
                  <li>
                    <strong>OpenDKIM</strong>
                    <span className="muted">出站 DKIM 簽署</span>
                  </li>
                </ul>
                <FormHint>
                  缺軟件時橫幅會顯示「一鍵安裝／重新探測」。安裝成功 ≠ 域名已可收發。
                </FormHint>
              </div>

              <div className="mail-card">
                <div className="mail-card__head">
                  <h3 className="mail-card__title">域名設定路徑</h3>
                </div>
                <ol className="mail-steps">
                  <li>右上角登記域名（控制面 draft）</li>
                  <li>進入域名詳情 → 一鍵設定郵件</li>
                  <li>DNS 頁或外部 checklist 加 MX／SPF／DKIM／DMARC</li>
                  <li>SSL 綁定 mail／webmail 主機名</li>
                </ol>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => setCreateOpen(true)}
                  >
                    + 建立郵件域名
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setTab('domains')}
                  >
                    查看域名列表
                  </Button>
                </FormActions>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'ops' ? (
          <div className="tab-panel mail-panel">
            <div className="mail-ops-grid">
              <div className="mail-card">
                <div className="mail-card__head">
                  <h3 className="mail-card__title">面板 vs 外部</h3>
                </div>
                <ul className="mail-bullets">
                  <li>
                    <strong>本頁</strong>：域名登記、佇列觀測、軟件探測
                  </li>
                  <li>
                    <strong>域名詳情</strong>：一鍵 bootstrap、信箱、別名、relay、webmail
                  </li>
                  <li>
                    <strong>主機商</strong>：PTR、Port 25 出站策略
                  </li>
                  <li>
                    <strong>域名商</strong>：MX／SPF／DKIM／DMARC 發佈
                  </li>
                </ul>
              </div>
              <div className="mail-card mail-card--muted">
                <div className="mail-card__head">
                  <h3 className="mail-card__title">誠實狀態</h3>
                </div>
                <ul className="mail-bullets">
                  <li>
                    <code>draft</code>：只在控制面
                  </li>
                  <li>
                    <code>written</code>：已寫管理檔，未必套到系統
                  </li>
                  <li>
                    <code>applied</code>：曾成功套用（仍視服務 is-active）
                  </li>
                  <li>國際收件匣信譽永遠無法 100% 自動化</li>
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </Tabs>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('email.create')}
        description="只登記郵件域名到控制面；軟件安裝、DNS、郵箱在詳情頁完成"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() => setCreateOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="email-create-form"
              variant="primary"
              size="md"
              loading={busy}
            >
              登記域名
            </Button>
          </>
        }
      >
        <form id="email-create-form" onSubmit={(e) => void onCreate(e)}>
          <FormLayout columns={2}>
            <Field
              label={t('email.domain')}
              htmlFor="edomain"
              flush
              required
              hint="apex 域名，例如 example.com（不含 mail. 前綴）"
            >
              <input
                id="edomain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                required
                autoFocus
                spellCheck={false}
              />
            </Field>
            <Field
              label={t('email.serverIp')}
              htmlFor="eip"
              flush
              required
              hint="此域名郵件服務對外 IP（常用於 MX／A 建議）"
            >
              <input
                id="eip"
                value={serverIp}
                onChange={(e) => {
                  setServerIp(e.target.value);
                  setServerContext({ serverIp: e.target.value });
                }}
                required
                placeholder="203.0.113.10"
                spellCheck={false}
              />
            </Field>
          </FormLayout>
          <FormHint>
            登記成功 ≠ 郵件已可收發。請到域名詳情完成一鍵設定、DNS 與 SSL。
          </FormHint>
        </form>
      </Modal>
    </FeaturePageLayout>
  );
}
