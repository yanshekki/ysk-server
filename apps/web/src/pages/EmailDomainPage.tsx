/**
 * Email domain detail — professional console layout (aligned with recent UX).
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { emailApi, type EmailBundle, type EmailDomain } from '../features/email';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  FeaturePageLayout,
  Field,
  FormLayout,
  LoadingBlock,
  Modal,
  OpsHero,
  OpsResultPanel,
  SoftwareInstallBanner,
  SummaryStrip,
  Tabs,
  FormActions,
  CheckboxField,
  FormHint,
  SegRadio,
} from '../shared/components/ui';
import type { OpsResultLike } from '../shared/components/ui';
import { api } from '../shared/services/api';

function asOps(r: Record<string, unknown> | null): OpsResultLike | null {
  if (!r) return null;
  return {
    ok: Boolean(r.ok ?? true),
    blocked: Boolean(r.blocked),
    blockMessage: typeof r.blockMessage === 'string' ? r.blockMessage : undefined,
    notes: Array.isArray(r.notes) ? r.notes.map(String) : [],
    ...r,
  } as OpsResultLike;
}

export function EmailDomainPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [domain, setDomain] = useState<EmailDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('dns');
  const [bundle, setBundle] = useState<EmailBundle | null>(null);
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const [dnsbl, setDnsbl] = useState<Record<string, unknown> | null>(null);
  const [warmup, setWarmup] = useState<Record<string, unknown> | null>(null);
  const [relayHost, setRelayHost] = useState('smtp.example.com');
  const [relayUser, setRelayUser] = useState('');
  const [relayPass, setRelayPass] = useState('');
  const [relayApplySystem, setRelayApplySystem] = useState(true);
  const [relayLog, setRelayLog] = useState<Record<string, unknown> | null>(null);
  const [bootstrapPassword, setBootstrapPassword] = useState('');
  const [mboxLocal, setMboxLocal] = useState('info');
  const [mboxPass, setMboxPass] = useState('');
  const [mboxLog, setMboxLog] = useState<Record<string, unknown> | null>(null);
  const [createMboxOpen, setCreateMboxOpen] = useState(false);
  const [mailboxes, setMailboxes] = useState<Array<Record<string, unknown>>>([]);
  const [aliases, setAliases] = useState<Array<Record<string, unknown>>>([]);
  const [aliasLocal, setAliasLocal] = useState('sales');
  const [aliasDest, setAliasDest] = useState('');
  const [aliasType, setAliasType] = useState<'forward' | 'alias' | 'catchall'>('forward');
  const [aliasLog, setAliasLog] = useState<Record<string, unknown> | null>(null);
  const [autoreplyOn, setAutoreplyOn] = useState(false);
  const [autoreplySubject, setAutoreplySubject] = useState('自動回覆');
  const [autoreplyBody, setAutoreplyBody] = useState('已收到您的郵件，稍後回覆。');
  const [webmailDomain, setWebmailDomain] = useState('webmail.example.com');
  const [webmailLog, setWebmailLog] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    const list = await emailApi.list();
    const found = list.items.find((d) => d.id === id) ?? null;
    setDomain(found);
    if (!found) return null;
    try {
      setBundle(await emailApi.dns(found.id));
      setMailboxes((await emailApi.listMailboxes(found.id)).items);
      setAliases((await emailApi.listAliases(found.id)).items);
      setWebmailDomain(`webmail.${found.domain}`);
    } catch {
      /* optional */
    }
    return found;
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load()
      .then((found) => {
        if (cancelled) return;
        if (!found) setError(t('email.notFound', { defaultValue: '找不到此郵件域名' }));
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, t]);

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingBlock />;
  if (!domain) {
    return (
      <FeaturePageLayout
        title={t('email.title')}
        showCapability={false}
        backTo="/email"
        backLabel={t('email.backToList', { defaultValue: '返回郵件域名' })}
      >
        <SoftwareInstallBanner feature="email" title="郵件所需軟件尚未安裝" />
        <Alert variant="error">
          {error ?? t('email.notFound', { defaultValue: '找不到此郵件域名' })}
        </Alert>
        <Button variant="secondary" size="md" onClick={() => navigate('/email')}>
          {t('email.backToList', { defaultValue: '返回郵件域名' })}
        </Button>
      </FeaturePageLayout>
    );
  }

  const tabs = [
    { id: 'dns', label: 'DNS' },
    { id: 'mailbox', label: '郵箱' },
    { id: 'aliases', label: '別名／轉發' },
    { id: 'health', label: '健康' },
    { id: 'relay', label: '中繼' },
    { id: 'sieve', label: '過濾／SSO' },
    { id: 'advanced', label: '進階' },
  ];

  const applySt = (domain.apply_status ?? 'draft').toLowerCase();

  return (
    <FeaturePageLayout
      title={domain.domain}
      subtitle={domain.server_ip}
      showCapability={false}
      backTo="/email"
      backLabel={t('email.backToList', { defaultValue: '返回郵件域名' })}
      actions={
        <div className="btn-row">
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() =>
              void withBusy(async () => {
                setBundle(await emailApi.dns(domain.id));
                setMailboxes((await emailApi.listMailboxes(domain.id)).items);
              })
            }
          >
            重新整理
          </Button>
        </div>
      }
    >
      <SoftwareInstallBanner feature="email" title="郵件所需軟件尚未安裝" />
      {error ? <Alert variant="error">{error}</Alert> : null}

      <OpsHero
        eyebrow="Mail domain"
        title={domain.domain}
        pill={
          applySt === 'applied'
            ? '已套用'
            : applySt === 'written'
              ? '管理檔'
              : '草稿'
        }
        pillTone={applySt === 'applied' ? 'ok' : 'warn'}
        tone={domain.health_score >= 80 ? 'ok' : 'warn'}
        hint={`IP ${domain.server_ip} · written ≠ 可收發（DNS/PTR/Port25 另計）`}
        stats={[
          {
            label: '健康',
            value: (
              <Badge tone={domain.health_score >= 80 ? 'ok' : 'warn'}>
                {domain.health_score}/100
              </Badge>
            ),
          },
          {
            label: '套用',
            value: (
              <Badge tone={applySt === 'applied' ? 'ok' : 'warn'}>
                {applySt === 'applied'
                  ? 'applied'
                  : applySt === 'written'
                    ? 'written'
                    : 'draft'}
              </Badge>
            ),
          },
          { label: '郵箱', value: mailboxes.length },
          { label: 'DNS 紀錄', value: bundle?.records.length ?? '—' },
        ]}
      />

      <Tabs tabs={tabs} active={tab} onChange={setTab} variant="scroll">
        {tab === 'dns' ? (
          <Card>
            <CardSection
              title="DNS 與待辦"
              description="建議紀錄可複製到外部 DNS 或到 DNS 頁建 zone（寫入 ≠ 權威上線）"
            >
              {bundle ? (
                <>
                  <div className="btn-row u-mb-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const text = bundle.records
                          .map((r) => `${r.type}\t${r.name}\t${r.value}`)
                          .join('\n');
                        void navigator.clipboard?.writeText(text);
                      }}
                    >
                      複製全部紀錄
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        navigate(`/dns`)
                      }
                    >
                      開啟 DNS 頁
                    </Button>
                  </div>
                  <DescriptionList
                    columns={2}
                    items={[
                      {
                        label: '健康分',
                        value: (
                          <Badge tone={bundle.health.score >= 80 ? 'ok' : 'warn'}>
                            {bundle.health.score}/{bundle.health.maxScore}
                          </Badge>
                        ),
                      },
                      { label: '建議紀錄數', value: String(bundle.records.length) },
                      { label: '外部待辦', value: String(bundle.externalTodos.length) },
                    ]}
                  />
                  {bundle.health.messages.length > 0 ? (
                    <ul className="muted list-flush u-mt-3">
                      {bundle.health.messages.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="table-wrap u-mt-4">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>類型</th>
                          <th>名稱</th>
                          <th>值</th>
                          <th>說明</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {bundle.records.map((r, i) => (
                          <tr key={`${r.type}-${r.name}-${i}`}>
                            <td>
                              <Badge>{r.type}</Badge>
                            </td>
                            <td>
                              <code className="inline">{r.name}</code>
                            </td>
                            <td className="u-break-all">
                              <code className="inline">{r.value}</code>
                            </td>
                            <td className="muted u-text-sm">{r.description}</td>
                            <td>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  void navigator.clipboard?.writeText(r.value)
                                }
                              >
                                複製
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {bundle.externalTodos.length > 0 ? (
                    <div className="u-mt-4">
                      <h4 className="u-mb-2">外部待辦（面板無法代勞）</h4>
                      <FormHint>
                        PTR、Port 25、registrar DNS、信譽 — 要喺主機商／域名商完成；複製 SPF/DKIM 後到 DNS 頁或外部面板新增。
                      </FormHint>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="u-mb-3"
                        onClick={() => {
                          const text = bundle.externalTodos
                            .map(
                              (t) =>
                                `- ${t.completed ? '[x]' : '[ ]'} ${t.title}: ${t.description}`,
                            )
                            .join('\n');
                          void navigator.clipboard?.writeText(text);
                        }}
                      >
                        複製外部待辦清單
                      </Button>
                      <ul className="list-plain list-spaced">
                        {bundle.externalTodos.map((todo) => (
                          <li key={todo.id}>
                            <Badge tone={todo.completed ? 'ok' : 'warn'}>
                              {todo.completed ? '完成' : '待辦'}
                            </Badge>{' '}
                            <strong>{todo.title}</strong>
                            <div className="muted u-text-sm">{todo.description}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  按右上角「重新整理」載入 DNS 建議
                </p>
              )}
            </CardSection>
          </Card>
        ) : null}

        {tab === 'mailbox' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={`郵箱列表（${mailboxes.length}）`}
                description="建立後可寫入 Dovecot 密碼庫（需系統變更權限）"
              >
                <div className="btn-row u-mb-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setMboxLocal('info');
                      setMboxPass('');
                      setCreateMboxOpen(true);
                    }}
                  >
                    + 建立郵箱
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        setMailboxes(
                          (await emailApi.listMailboxes(domain.id)).items,
                        );
                      })
                    }
                  >
                    重新整理
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        setMboxLog(await emailApi.dovecotPassdb(domain.id));
                      })
                    }
                  >
                    寫入 Dovecot 密碼庫
                  </Button>
                </div>
                {mailboxes.length > 0 ? (
                  <ul className="list-plain list-spaced">
                    {mailboxes.map((m) => (
                      <li key={String(m.id)}>
                        <code className="inline">{String(m.address)}</code>{' '}
                        <Badge tone={String(m.status) === 'active' ? 'ok' : 'neutral'}>
                          {String(m.status ?? '—')}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">尚未有郵箱 — 按「建立郵箱」開啟對話框</p>
                )}
                <OpsResultPanel title="郵箱操作結果" result={asOps(mboxLog)} busy={busy} />
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'aliases' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title="別名／轉發／Catch-all" description="把地址轉到其他信箱">
                <FormLayout columns={2}>
                  <Field label="類型" htmlFor="al-type" flush>
                    <SegRadio
                      name="al-type"
                      aria-label="別名類型"
                      value={aliasType}
                      onChange={(v) =>
                        setAliasType(v as 'forward' | 'alias' | 'catchall')
                      }
                      options={[
                        { value: 'forward', label: '轉發' },
                        { value: 'alias', label: '別名' },
                        { value: 'catchall', label: 'Catch-all' },
                      ]}
                    />
                  </Field>
                  {aliasType !== 'catchall' ? (
                    <Field label="本地部分" htmlFor="al-local" hint="例如 sales" flush>
                      <input
                        id="al-local"
                        value={aliasLocal}
                        onChange={(e) => setAliasLocal(e.target.value)}
                        placeholder="sales"
                      />
                    </Field>
                  ) : null}
                  <Field
                    label="目標信箱"
                    htmlFor="al-dest"
                    hint="可用逗號分隔多個"
                    fullWidth
                    flush
                  >
                    <input
                      id="al-dest"
                      value={aliasDest}
                      onChange={(e) => setAliasDest(e.target.value)}
                      placeholder={`info@${domain.domain}`}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        const destinations = aliasDest
                          .split(/[,;\s]+/)
                          .map((s) => s.trim())
                          .filter(Boolean);
                        setAliasLog(
                          await emailApi.createAlias(domain.id, {
                            type: aliasType,
                            localPart: aliasType === 'catchall' ? undefined : aliasLocal,
                            destinations,
                          }),
                        );
                        setAliases((await emailApi.listAliases(domain.id)).items);
                      })
                    }
                  >
                    新增別名
                  </Button>
                </FormActions>
                {aliases.length > 0 ? (
                  <ul className="list-plain list-spaced u-mt-4">
                    {aliases.map((a) => (
                      <li key={String(a.id)} className="btn-row" style={{ justifyContent: 'space-between' }}>
                        <span>
                          <Badge>{String(a.type)}</Badge>{' '}
                          <code className="inline">{String(a.source)}</code> →{' '}
                          {(a.destinations as string[] | undefined)?.join(', ')}
                        </span>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={busy}
                          onClick={() =>
                            void withBusy(async () => {
                              setAliasLog(
                                await emailApi.deleteAlias(domain.id, String(a.id)),
                              );
                              setAliases((await emailApi.listAliases(domain.id)).items);
                            })
                          }
                        >
                          刪除
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted u-mt-3">尚未有別名／轉發</p>
                )}
                <OpsResultPanel title="別名結果" result={asOps(aliasLog)} busy={busy} />
              </CardSection>
            </Card>
            <Card>
              <CardSection title="自動回覆" description="寫入域名旗標；真正寄出需 MTA／Sieve 支援">
                <div className="form-switches">
                  <CheckboxField
                    id="ar-on"
                    label="啟用自動回覆"
                    description="開啟後儲存主旨與內文"
                    checked={autoreplyOn}
                    onChange={setAutoreplyOn}
                  />
                </div>
                <FormLayout>
                  <Field label="主旨" htmlFor="ar-sub" flush>
                    <input
                      id="ar-sub"
                      value={autoreplySubject}
                      onChange={(e) => setAutoreplySubject(e.target.value)}
                    />
                  </Field>
                  <Field label="內文" htmlFor="ar-body" fullWidth flush>
                    <textarea
                      id="ar-body"
                      rows={4}
                      value={autoreplyBody}
                      onChange={(e) => setAutoreplyBody(e.target.value)}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        await emailApi.updateFlags(domain.id, {
                          autoreplyEnabled: autoreplyOn,
                          autoreplySubject,
                          autoreplyBody,
                        });
                        setAliasLog({
                          ok: true,
                          notes: ['已儲存自動回覆旗標'],
                        });
                      })
                    }
                  >
                    儲存自動回覆
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        await emailApi.updateFlags(domain.id, { suspended: true });
                        setAliasLog({ ok: true, notes: ['域名已標記暫停'] });
                        await load();
                      })
                    }
                  >
                    暫停域名
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        await emailApi.updateFlags(domain.id, { suspended: false });
                        setAliasLog({ ok: true, notes: ['域名已恢復'] });
                        await load();
                      })
                    }
                  >
                    恢復域名
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'health' ? (
          <Card>
            <CardSection title="健康探測" description="Live 埠／DNSBL／暖身檢查（唯讀為主）">
              <SummaryStrip
                items={[
                  {
                    label: '伺服器 IP',
                    value: domain.server_ip || '—',
                  },
                  {
                    label: '即時檢查',
                    value: live
                      ? (live as { ok?: boolean }).ok
                        ? '正常'
                        : '有問題'
                      : '未測',
                    tone: live
                      ? (live as { ok?: boolean }).ok
                        ? 'ok'
                        : 'warn'
                      : 'default',
                  },
                  {
                    label: '黑名單',
                    value: dnsbl
                      ? (dnsbl as { ok?: boolean }).ok
                        ? 'Clean'
                        : 'Listed'
                      : '未測',
                    tone: dnsbl
                      ? (dnsbl as { ok?: boolean }).ok
                        ? 'ok'
                        : 'danger'
                      : 'default',
                  },
                  {
                    label: '外部待辦',
                    value: 'PTR / Port25',
                    tone: 'warn',
                  },
                ]}
              />
              <p className="muted u-text-sm u-mb-3">
                面板外必須自行處理：供應商 PTR、出站 Port 25、Registrar DS（DNSSEC）。
              </p>
              <div className="lifecycle-toolbar">
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void withBusy(async () => {
                      setLive(await emailApi.liveCheck(domain.id));
                    })
                  }
                >
                  Live 檢查
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void withBusy(async () => {
                      setDnsbl(await emailApi.dnsbl(domain.server_ip));
                    })
                  }
                >
                  DNSBL
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void withBusy(async () => {
                      const ips = [domain.server_ip];
                      try {
                        const hostIps = await api.requestRaw<{ items: string[] }>(
                          '/api/v1/system/ips',
                        );
                        ips.push(...(hostIps.items ?? []));
                      } catch {
                        /* optional */
                      }
                      setDnsbl(await emailApi.dnsblMulti([...new Set(ips)]));
                    })
                  }
                >
                  多 IP RBL
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void withBusy(async () => {
                      setWarmup(await emailApi.warmupDomain(domain.id));
                    })
                  }
                >
                  暖身建議
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void withBusy(async () => {
                      setLive(
                        await api.requestRaw(`/api/v1/email/domains/${domain.id}/policy`, {
                          method: 'POST',
                          body: JSON.stringify({
                            rateLimitPerHour: 200,
                            antispam: true,
                            applySystem: false,
                          }),
                        }),
                      );
                    })
                  }
                >
                  寫入限速/反垃圾（written）
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void withBusy(async () => {
                      setLive(
                        await api.requestRaw(`/api/v1/email/domains/${domain.id}/policy`, {
                          method: 'POST',
                          body: JSON.stringify({
                            rateLimitPerHour: 200,
                            antispam: true,
                            applySystem: true,
                          }),
                        }),
                      );
                    })
                  }
                >
                  套用限速/反垃圾到系統
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void withBusy(async () => {
                      setLive(
                        await api.requestRaw('/api/v1/email/webmail/sso-plugin', {
                          method: 'POST',
                          body: JSON.stringify({}),
                        }),
                      );
                    })
                  }
                >
                  寫入 Roundcube SSO 骨架
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void withBusy(async () => {
                      setLive(
                        await api.requestRaw('/api/v1/email/webmail/sso-plugin', {
                          method: 'POST',
                          body: JSON.stringify({ enableSystem: true }),
                        }),
                      );
                    })
                  }
                >
                  SSO 骨架 + 系統 symlink
                </Button>
              </div>
              {live ? <OpsResultPanel title="即時檢查" result={asOps(live)} /> : null}
              {dnsbl ? <OpsResultPanel title="黑名單（DNSBL）" result={asOps(dnsbl)} /> : null}
              {warmup ? <OpsResultPanel title="暖身" result={asOps(warmup)} /> : null}
            </CardSection>
          </Card>
        ) : null}

        {tab === 'relay' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="SMTP 出站中繼"
                description="經外部 SMTP 寄信；套用到系統才會寫 Postfix（需系統變更權限）"
              >
                <FormLayout columns={2}>
                  <Field label="中繼主機" htmlFor="rh" required flush>
                    <input
                      id="rh"
                      value={relayHost}
                      onChange={(e) => setRelayHost(e.target.value)}
                      placeholder="smtp.example.com"
                    />
                  </Field>
                  <Field label="用戶名" htmlFor="ru" flush>
                    <input
                      id="ru"
                      value={relayUser}
                      onChange={(e) => setRelayUser(e.target.value)}
                    />
                  </Field>
                  <Field label="密碼" htmlFor="rp" flush>
                    <input
                      id="rp"
                      type="password"
                      value={relayPass}
                      onChange={(e) => setRelayPass(e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                </FormLayout>
                <div className="form-switches">
                  <CheckboxField
                    id="ras"
                    label="套用到系統 Postfix"
                    description="關閉則只儲存在控制面"
                    checked={relayApplySystem}
                    onChange={setRelayApplySystem}
                  />
                </div>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        setRelayLog(
                          await emailApi.setRelay({
                            host: relayHost,
                            port: 587,
                            username: relayUser || undefined,
                            password: relayPass || undefined,
                            security: 'starttls',
                            applySystem: relayApplySystem,
                          }),
                        );
                      })
                    }
                  >
                    {relayApplySystem ? '儲存並套用到系統' : '只儲存設定'}
                  </Button>
                </FormActions>
                <OpsResultPanel title="中繼結果" result={asOps(relayLog)} busy={busy} />
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'sieve' ? (
          <div className="stack">
            <Card>
              <CardSection
                title="Webmail 單點登入"
                description="簽發一次性 token；webmail 端需認 token。不假稱已完整整合 Roundcube"
              >
                <FormLayout>
                  <Field
                    label="信箱密碼（可選）"
                    htmlFor="sso-pw"
                    flush
                    hint={`用於 postmaster@${domain.domain} 真自動登入；留空則僅簽發 token`}
                  >
                    <input
                      id="sso-pw"
                      type="password"
                      autoComplete="new-password"
                      placeholder="填寫後 token 可自動登入 Roundcube"
                    />
                  </Field>
                </FormLayout>
                <FormHint>Token 預設 10 分鐘有效；僅供管理面板測試／對接，非終端使用者流程。</FormHint>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        const pwEl = document.getElementById('sso-pw') as HTMLInputElement | null;
                        const password = pwEl?.value || undefined;
                        const email = `postmaster@${domain.domain}`;
                        const r = await emailApi.webmailSso({
                          email,
                          domain: domain.domain,
                          ttlMinutes: 10,
                          password,
                        });
                        setWebmailLog(r as Record<string, unknown>);
                      })
                    }
                  >
                    簽發 SSO token
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            <Card>
              <CardSection
                title="Sieve 過濾"
                description="寫入 dataDir/email/sieve；寫入 ≠ Dovecot 已載入"
              >
                <FormHint>
                  對 postmaster@{domain.domain} 寫入預設範本（含垃圾信 fileinto 註解示例）。
                </FormHint>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        const mailbox = `postmaster@${domain.domain}`;
                        const r = await emailApi.writeSieve({
                          mailbox,
                          name: 'default.sieve',
                          content: `require ["fileinto"];\n# YSK sieve for ${domain.domain}\n# if header :contains "X-Spam-Flag" "YES" { fileinto "Junk"; stop; }\n`,
                        });
                        setWebmailLog(r);
                      })
                    }
                  >
                    寫入預設 Sieve
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        const mailbox = `postmaster@${domain.domain}`;
                        setWebmailLog(await emailApi.listSieve(mailbox));
                      })
                    }
                  >
                    列出已寫入檔案
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            {webmailLog ? <OpsResultPanel title="結果" result={asOps(webmailLog)} /> : null}
          </div>
        ) : null}

        {tab === 'advanced' ? (
          <div className="stack">
            <Card>
              <CardSection
                title="此域名 SSL"
                description="跳轉 SSL 頁並預填域名，申請 Let’s Encrypt"
              >
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() =>
                      navigate(
                        `/ssl?domain=${encodeURIComponent(domain.domain)}&action=le`,
                      )
                    }
                  >
                    申請 {domain.domain} 憑證
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            <Card>
              <CardSection
                title="用戶端自動設定"
                description="產生 Mozilla Autoconfig／Outlook Autodiscover XML"
              >
                <FormHint>產生後會嘗試複製 Mozilla XML 到剪貼簿；詳情見下方操作結果。</FormHint>
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        const r = await emailApi.autodiscover(domain.id);
                        setWebmailLog({
                          ok: true,
                          notes: r.notes,
                          mozillaXml: r.mozillaXml.slice(0, 200) + '…',
                          urls: r.urls,
                        });
                        void navigator.clipboard?.writeText(r.mozillaXml);
                      })
                    }
                  >
                    產生並複製設定 XML
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            <Card>
              <CardSection
                title="郵件佇列"
                description="查詢或清空本機 MTA 佇列（亦可在郵件首頁操作；需系統變更權限）"
              >
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        const r = await emailApi.mailQueue();
                        setWebmailLog({
                          ...r,
                          items: (r.items ?? []).slice(0, 20),
                        });
                      })
                    }
                  >
                    查看佇列
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        setWebmailLog(await emailApi.flushQueue({ all: true }));
                      })
                    }
                  >
                    清空佇列
                  </Button>
                </FormActions>
                <FormHint>
                  公開 Autoconfig：
                  <code className="inline">
                    /mail/config-v1.1.xml?domain={domain.domain}
                  </code>
                </FormHint>
              </CardSection>
            </Card>
            <Card>
              <CardSection
                title="一鍵設定郵件"
                description="安裝套件並套用郵件堆疊（需系統變更 + 管理員）。必須自訂管理員密碼。"
              >
                <FormLayout>
                  <Field
                    label="管理員密碼"
                    htmlFor="boot-pw"
                    flush
                    required
                    hint="postmaster 密碼，至少 8 字元"
                  >
                    <input
                      id="boot-pw"
                      type="password"
                      value={bootstrapPassword}
                      onChange={(e) => setBootstrapPassword(e.target.value)}
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="至少 8 字元"
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    disabled={bootstrapPassword.trim().length < 8}
                    onClick={() =>
                      void withBusy(async () => {
                        if (bootstrapPassword.trim().length < 8) {
                          setError('請設定至少 8 字元的管理員密碼');
                          return;
                        }
                        setWebmailLog(
                          await emailApi.bootstrap({
                            domain: domain.domain,
                            serverIp: domain.server_ip,
                            adminLocalPart: 'postmaster',
                            adminPassword: bootstrapPassword.trim(),
                            installPackages: true,
                            webmail: true,
                          }),
                        );
                        await load();
                      })
                    }
                  >
                    一鍵設定郵件
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            <Card>
              <CardSection
                title="Webmail（Roundcube）"
                description="下載／套用 Roundcube；written ≠ 虛擬主機已對外服務"
              >
                <FormLayout columns={2}>
                  <Field
                    label="Webmail 主機名"
                    htmlFor="wmd"
                    flush
                    hint="虛擬主機 server_name，例如 webmail.example.com"
                  >
                    <input
                      id="wmd"
                      value={webmailDomain}
                      onChange={(e) => setWebmailDomain(e.target.value)}
                      placeholder={`webmail.${domain.domain}`}
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        setWebmailLog(
                          await emailApi.webmailApply({
                            domain: webmailDomain,
                            download: true,
                          }),
                        );
                      })
                    }
                  >
                    安裝／套用 Webmail
                  </Button>
                </FormActions>
                <OpsResultPanel
                  title="一鍵設定／Webmail 結果"
                  result={asOps(webmailLog)}
                  busy={busy}
                />
              </CardSection>
            </Card>
          </div>
        ) : null}
      </Tabs>

      <Modal
        open={createMboxOpen}
        onClose={() => setCreateMboxOpen(false)}
        title="建立郵箱"
        description={`完整位址會是 ${mboxLocal || '…'}@${domain.domain}`}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setCreateMboxOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() =>
                void withBusy(async () => {
                  setMboxLog(
                    await emailApi.createMailbox(domain.id, {
                      localPart: mboxLocal,
                      password: mboxPass || undefined,
                    }),
                  );
                  setMailboxes(
                    (await emailApi.listMailboxes(domain.id)).items,
                  );
                  setCreateMboxOpen(false);
                  setMboxPass('');
                })
              }
            >
              建立郵箱
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field
            label="本地部分"
            htmlFor="mlocal"
            hint={`完整位址會是 ${mboxLocal || '…'}@${domain.domain}`}
            required
            flush
          >
            <input
              id="mlocal"
              value={mboxLocal}
              onChange={(e) => setMboxLocal(e.target.value)}
              placeholder="info"
            />
          </Field>
          <Field
            label="密碼"
            htmlFor="mpass"
            hint="可選；至少 8 位才會寫入雜湊"
            flush
          >
            <input
              id="mpass"
              type="password"
              value={mboxPass}
              onChange={(e) => setMboxPass(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </FormLayout>
      </Modal>
    </FeaturePageLayout>
  );
}
