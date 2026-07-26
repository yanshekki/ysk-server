/**
 * Email domains list — FeaturePageLayout + honest status (registry vs applied).
 */
import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEmailDomains } from '../features/email';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormLayout,
  Modal,
  SoftwareInstallBanner,
  SummaryStrip,
  FormHint,
} from '../shared/components/ui';
import { getServerContext, setServerContext } from '../shared/stores/server-context';

function applyLabel(status?: string): { text: string; tone: 'ok' | 'info' | 'neutral' | 'warn' } {
  const s = (status ?? 'draft').toLowerCase();
  if (s === 'applied') return { text: '已套用到系統', tone: 'ok' };
  if (s === 'written') return { text: '已寫入管理檔', tone: 'info' };
  if (s === 'failed') return { text: '失敗', tone: 'warn' };
  return { text: '已登記（草稿）', tone: 'neutral' };
}

export function EmailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ctx = getServerContext();
  const { items, error, setError, busy, create, refresh } = useEmailDomains();
  const [createOpen, setCreateOpen] = useState(false);
  const [domain, setDomain] = useState('');
  const [serverIp, setServerIp] = useState(ctx.serverIp);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((d) => d.domain.toLowerCase().includes(q));
  }, [items, query]);

  const applied = items.filter((d) => (d.apply_status ?? '').toLowerCase() === 'applied').length;
  const healthy = items.filter((d) => d.health_score >= 80).length;

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

  return (
    <FeaturePageLayout
      title={t('email.title')}
      subtitle="域名 · DNS · 信箱 · Relay"
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
      <SoftwareInstallBanner feature="email" title="郵件所需軟件尚未安裝" />
      {error ? <Alert variant="error">{error}</Alert> : null}

      <SummaryStrip
        items={[
          { label: '域名', value: items.length },
          { label: '健康 ≥80', value: healthy, tone: healthy > 0 ? 'ok' : 'default' },
          {
            label: '已套用系統',
            value: applied,
            tone: applied > 0 ? 'ok' : 'warn',
          },
        ]}
      />

      <Alert variant="info">
        列表僅為控制面<strong>登記</strong>。要真正安裝 Postfix／Dovecot／Webmail，請進入域名詳情使用「一鍵設定郵件」。
      </Alert>

      <div className="page-toolbar">
        <div className="page-toolbar__search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('email.searchPlaceholder')}
            aria-label={t('email.searchPlaceholder')}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={t('email.empty')}
          description={t('email.emptyHint')}
          action={
            <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
              + {t('email.create')}
            </Button>
          }
        />
      ) : (
        <div className="list-panel" role="list">
          {filtered.map((d) => {
            const st = applyLabel(d.apply_status);
            return (
              <Link key={d.id} to={`/email/domains/${d.id}`} className="list-row">
                <div className="list-row__main">
                  <div className="list-row__title">
                    <span>{d.domain}</span>
                    <Badge tone={st.tone}>{st.text}</Badge>
                  </div>
                  <div className="list-row__meta">
                    <span>IP {d.server_ip}</span>
                  </div>
                </div>
                <div className="list-row__side">
                  <Badge tone={d.health_score >= 80 ? 'ok' : 'warn'}>{d.health_score}/100</Badge>
                  <span className="list-row__chevron" aria-hidden>
                    ›
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

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
            <Button type="submit" form="email-create-form" variant="primary" size="md" loading={busy}>
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
