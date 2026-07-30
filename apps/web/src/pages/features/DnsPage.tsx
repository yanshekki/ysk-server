import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { 
  DataTable,
  ActionBar,
  Alert,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormLayout,
  Modal,
  SoftwareInstallBanner,
  PageTabs,
  FormActions,
  FormHint,
  PresetChips,
  SegRadio,

  buttonClassName,} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';

const DNS_TABS = ['zones', 'records', 'cluster', 'dnssec', 'tools'] as const;
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import type { ResourceRow } from '../../features/resources/api';
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';

const ZONE_TEMPLATES = [
  { id: 'minimal', label: '最小 — 僅 apex A' },
  { id: 'web', label: '網站 — apex + www' },
  { id: 'mail', label: '郵件 — apex + mail + MX + SPF' },
  { id: 'full', label: '完整 — web + mail + ftp + SPF' },
  { id: 'cdn', label: 'CDN — apex + www + cdn（多 edge 預留）' },
] as const;

export function DnsPage() {
  const { t } = useTranslation();
  const zones = useResourceCrud('dns/zones');
  const [selectedZone, setSelectedZone] = useState<ResourceRow | null>(null);
  const recordsQuery = useMemo(
    () => (selectedZone ? { zoneId: selectedZone.id } : undefined),
    [selectedZone],
  );
  const records = useResourceCrud('dns/records', recordsQuery);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [editRec, setEditRec] = useState<ResourceRow | null>(null);
  const [delZone, setDelZone] = useState<string | null>(null);
  const [delRec, setDelRec] = useState<string | null>(null);
  const [zone, setZone] = useState('');
  const [serverIp, setServerIp] = useState('');
  const [serverIpv6, setServerIpv6] = useState('');
  const [template, setTemplate] = useState<(typeof ZONE_TEMPLATES)[number]['id']>('full');
  const [rtype, setRtype] = useState('A');
  const [rname, setRname] = useState('@');
  const [rvalue, setRvalue] = useState('');
  const [rttl, setRttl] = useState('300');
  const [dnssecBusy, setDnssecBusy] = useState(false);
  const [dnssecMsg, setDnssecMsg] = useState<string | null>(null);
  const [dnssecNotes, setDnssecNotes] = useState<string[]>([]);
  const [dnssecDs, setDnssecDs] = useState<string | null>(null);
  const [peerHost, setPeerHost] = useState('');
  const [peerUser, setPeerUser] = useState('ysk');
  const [peerLabel, setPeerLabel] = useState('');
  const [peers, setPeers] = useState<Array<Record<string, unknown>>>([]);
  const [clusterBusy, setClusterBusy] = useState(false);
  const [clusterMsg, setClusterMsg] = useState<string | null>(null);
  const [clusterNotes, setClusterNotes] = useState<string[]>([]);
  const [clusterApplyStatus, setClusterApplyStatus] = useState<string | null>(
    null,
  );
  const [clusterPeerResults, setClusterPeerResults] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [soaNs, setSoaNs] = useState('');
  const [soaTtl, setSoaTtl] = useState('300');
  /** Edit SOA for selected zone (persist + re-write zone file) */
  const [editSoaNs, setEditSoaNs] = useState('');
  const [editSoaTtl, setEditSoaTtl] = useState('300');
  const [soaBusy, setSoaBusy] = useState(false);
  const [soaMsg, setSoaMsg] = useState<string | null>(null);
  /** Tools tab: dig/lookup */
  const [lookupName, setLookupName] = useState('');
  const [lookupType, setLookupType] = useState('A');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<{
    ok: boolean;
    answers: string[];
    notes: string[];
    method?: string;
    latencyMs?: number;
  } | null>(null);
  const [validateMsg, setValidateMsg] = useState<string | null>(null);

  // Keep selected zone row in sync after apply/refresh
  const selectedLive = useMemo(() => {
    if (!selectedZone) return null;
    return zones.items.find((z) => z.id === selectedZone.id) ?? selectedZone;
  }, [zones.items, selectedZone]);

  // Prefill SOA fields when selection changes
  useEffect(() => {
    if (!selectedLive) return;
    setEditSoaNs(String(selectedLive.nsName ?? ''));
    setEditSoaTtl(String(selectedLive.ttl ?? 300));
    setSoaMsg(null);
  }, [selectedLive?.id, selectedLive?.nsName, selectedLive?.ttl]);

  async function onDnssec(zoneName: string) {
    setDnssecBusy(true);
    setDnssecMsg(null);
    setDnssecDs(null);
    setDnssecNotes([]);
    try {
      const r = await api.requestRaw<{
        ok: boolean;
        notes?: string[];
        dsRecord?: string;
        publicKey?: string;
        files?: string[];
      }>(`/api/v1/dns/zones/${encodeURIComponent(zoneName)}/dnssec`, {
        method: 'POST',
        body: '{}',
      });
      setDnssecNotes(r.notes ?? []);
      setDnssecDs(r.dsRecord ?? null);
      setDnssecMsg(
        r.ok
          ? '已產生 DNSSEC 金鑰（written — 未簽署 zone／未上 registrar）'
          : 'DNSSEC 未產生金鑰（只寫說明檔或工具不可用 — 唔假成功）',
      );
      const listed = await api.requestRaw<{ files?: string[]; notes?: string[] }>(
        `/api/v1/dns/zones/${encodeURIComponent(zoneName)}/dnssec`,
      );
      if (listed.notes?.length) setDnssecNotes((n) => [...n, ...listed.notes!]);
    } catch (e) {
      setDnssecMsg(e instanceof Error ? e.message : 'DNSSEC 失敗');
    } finally {
      setDnssecBusy(false);
    }
  }

  async function onCreateZone(e: FormEvent) {
    e.preventDefault();
    const item = await zones.create({
      zone,
      serverIp,
      ...(serverIpv6.trim() ? { serverIpv6: serverIpv6.trim() } : {}),
      backend: 'bind',
      template,
      nsName: soaNs.trim() || undefined,
      ttl: Number(soaTtl) || 300,
    });
    setZoneOpen(false);
    setSelectedZone(item);
    setZone('');
    setServerIpv6('');
    setTemplate('full');
  }

  async function refreshPeers() {
    const r = await api.requestRaw<{ items: Array<Record<string, unknown>> }>(
      '/api/v1/dns/cluster/peers',
    );
    setPeers(r.items ?? []);
  }

  async function runClusterOp(
    path: string,
    body: Record<string, unknown> = {},
  ) {
    setClusterBusy(true);
    setClusterMsg(null);
    setClusterNotes([]);
    setClusterPeerResults([]);
    setClusterApplyStatus(null);
    try {
      // Use raw fetch so HTTP 422 partial still returns peers[] (api.request throws).
      const bearer = authStore.getToken();
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const r = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        apply_status?: string;
        notes?: string[];
        peers?: Array<Record<string, unknown>>;
        blocked?: boolean;
        message?: string;
      };
      setClusterApplyStatus(r.apply_status ?? null);
      setClusterNotes(r.notes ?? []);
      setClusterPeerResults(r.peers ?? []);
      if (r.blocked || r.apply_status === 'blocked') {
        setClusterMsg('已封鎖（需系統變更權限）');
      } else if (r.ok) {
        setClusterMsg(`完成（${r.apply_status ?? 'ok'}）`);
      } else {
        setClusterMsg(
          `未全部成功（${r.apply_status ?? res.status}）— 見下方明細`,
        );
      }
      await refreshPeers();
    } catch (e) {
      setClusterMsg(e instanceof Error ? e.message : '叢集操作失敗');
    } finally {
      setClusterBusy(false);
    }
  }

  async function onSaveRec(e: FormEvent) {
    e.preventDefault();
    if (!selectedZone) return;
    const val = rvalue.trim();
    const body = {
      zoneId: selectedZone.id,
      type: rtype,
      name: rname,
      value: val,
      ttl: Number(rttl) || 300,
    };
    // Server-side validation (honest); also check set conflicts with existing
    try {
      const existing = records.items.map((r) => ({
        type: String(r.type ?? ''),
        name: String(r.name ?? '@'),
        value: String(r.value ?? ''),
        ttl: Number(r.ttl) || 300,
      }));
      const withoutEdit = editRec
        ? existing.filter((r, i) => records.items[i]?.id !== editRec.id)
        : existing;
      const check = await api.requestRaw<{
        ok: boolean;
        issues?: Array<{ level: string; message: string }>;
        notes?: string[];
      }>('/api/v1/dns/validate', {
        method: 'POST',
        body: JSON.stringify({
          records: [...withoutEdit, body],
        }),
      });
      if (!check.ok) {
        const msg =
          check.issues
            ?.filter((i) => i.level === 'error')
            .map((i) => i.message)
            .join('；') ||
          check.notes?.join('；') ||
          '記錄驗證失敗';
        setValidateMsg(msg);
        return;
      }
      setValidateMsg(null);
    } catch (err) {
      setValidateMsg(err instanceof Error ? err.message : '驗證請求失敗');
      return;
    }
    if (editRec) await records.update(editRec.id, body);
    else await records.create(body);
    setRecOpen(false);
    setEditRec(null);
    setRvalue('');
  }

  async function onLookup(e: FormEvent) {
    e.preventDefault();
    setLookupBusy(true);
    setLookupResult(null);
    try {
      const r = await api.requestRaw<{
        ok: boolean;
        answers: string[];
        notes: string[];
        method?: string;
        latencyMs?: number;
      }>('/api/v1/dns/lookup', {
        method: 'POST',
        body: JSON.stringify({
          name: lookupName.trim(),
          type: lookupType,
        }),
      });
      setLookupResult(r);
    } catch (err) {
      setLookupResult({
        ok: false,
        answers: [],
        notes: [err instanceof Error ? err.message : '查詢失敗'],
      });
    } finally {
      setLookupBusy(false);
    }
  }

  const [tab, setTab] = usePageTab(DNS_TABS, 'zones');

  // Load cluster peers when opening 叢集 tab
  useEffect(() => {
    if (tab === 'cluster') void refreshPeers().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on tab only
  }, [tab]);

  return (
    <FeaturePageLayout
      title={t('nav.dns', { defaultValue: 'DNS' })}
      showCapability={false}
      status={{
        pill: {
          label: `${zones.items.length} zones`,
          tone: zones.items.length ? 'ok' : 'warn',
        },
        items: [
          { label: 'Zones', value: zones.items.length },
          { label: '紀錄', value: records.items.length },
          { label: 'Peers', value: peers.length },
          {
            label: '選中',
            value: selectedLive ? String(selectedLive.zone ?? selectedLive.id) : '—',
          },
        ],
      }}
      actions={<>
          
          <Button variant="secondary" size="sm" onClick={() => setTab('records')}>
            紀錄
          </Button>
          <Link to="/ssl" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            SSL
          </Link>
        </>
      }
    >
      <SoftwareInstallBanner feature="dns" title="DNS 所需軟件尚未安裝" />
      {zones.error || records.error ? (
        <Alert variant="error">{zones.error ?? records.error}</Alert>
      ) : null}
      {zones.msg ? (
        <Alert variant="ok">
          {zones.msg}{' '}
          <button type="button" className={buttonClassName({ variant: 'ghost', size: 'sm' })} onClick={() => zones.setMsg(null)}>
            關閉
          </button>
        </Alert>
      ) : null}
      {dnssecMsg ? (
        <Alert
          variant={
            /失敗|未完成|未產生|唔假成功/.test(dnssecMsg) ? 'error' : 'ok'
          }
        >
          {dnssecMsg}
          {dnssecDs ? (
            <p className="u-mt-2">
              DS（供 registrar，未自動發佈）：
              <code className="inline u-break-all">{dnssecDs}</code>
            </p>
          ) : null}
          {dnssecNotes.length ? (
            <ul className="list-plain u-mt-2">
              {dnssecNotes.map((n) => (
                <li key={n} className="muted u-text-sm">
                  {n}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {validateMsg ? (
        <Alert variant="error">
          {validateMsg}{' '}
          <button
            type="button"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
            onClick={() => setValidateMsg(null)}
          >
            關閉
          </button>
        </Alert>
      ) : null}
      <PageTabs
        tabs={[
          { id: 'zones', label: '區域', badge: zones.items.length || undefined },
          {
            id: 'records',
            label: '記錄',
            badge: selectedLive ? records.items.length || undefined : undefined,
          },
          { id: 'cluster', label: '叢集', badge: peers.length || undefined },
          { id: 'dnssec', label: 'DNSSEC' },
          { id: 'tools', label: '工具' },
        ]}
        active={tab}
        onChange={(id) => {
          setTab(id);
          if (id === 'records' && !selectedZone && zones.items[0]) {
            setSelectedZone(zones.items[0]);
          }
        }}
        variant="scroll"
      >
        {tab === 'zones' ? (
          <div className="tab-panel">
            {zones.lastNotes.length > 0 ? (
              <Card>
                <CardSection title="最近寫入結果">
                  <ul className="notes-list">
                    {zones.lastNotes.map((n) => (
                      <li key={n} className="muted u-text-sm">
                        {n}
                      </li>
                    ))}
                  </ul>
                </CardSection>
              </Card>
            ) : null}
            <DataTable
                  rowKey={(r, i) => String((r as { id?: string }).id ?? i)}
                  title={`區域 (${zones.items.length})`}
                  description="建立區域後可寫入／套用 zone"
                  toolbar={
                    <ActionBar>
                      <Button variant="primary" size="sm" onClick={() => setZoneOpen(true)}>
                        + 建立區域
                      </Button>
                    </ActionBar>
                  }
                  columns={[
                    {
                      key: 'zone',
                      header: '區域名稱',
                      render: (r) => (
                        <button
                          type="button"
                          className={buttonClassName({ variant: 'link', size: 'md' })}
                          onClick={() => {
                            setSelectedZone(r);
                            setTab('records');
                          }}
                        >
                          <strong>{String(r.zone)}</strong>
                        </button>
                      ),
                    },
                    { key: 'ip', header: '伺服器 IP', render: (r) => String(r.serverIp ?? '—') },
                    {
                      key: 'tpl',
                      header: '模板',
                      render: (r) => String(r.template ?? 'full'),
                    },
                    {
                      key: 'status',
                      header: '狀態',
                      render: (r) => <ResourceStatusBadge status={String(r.apply_status)} />,
                    },
                  ]}
                  rows={zones.items}
                  empty={
                    <EmptyState
                      title="尚未有 DNS 區域"
                      description="用列表右上角「建立區域」新增"
                    />
                  }
                  rowActions={(r) => (
                    <ActionBar>
                      <button
                        type="button"
                        className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                        disabled={zones.busy}
                        onClick={() => void zones.apply(r.id)}
                        title="寫入管理 zone 檔；有權限時 named-checkzone + 嘗試 reload"
                      >
                        寫入／套用
                      </button>
                      <button
                        type="button"
                        className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                        onClick={() => {
                          setSelectedZone(r);
                          setTab('records');
                        }}
                      >
                        記錄
                      </button>
                      <button
                        type="button"
                        className={buttonClassName({ variant: 'danger', size: 'sm' })}
                        disabled={zones.busy}
                        onClick={() => setDelZone(r.id)}
                      >
                        刪除
                      </button>
                    </ActionBar>
                  )}
                />
          </div>
        ) : null}

        {tab === 'records' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={
                  selectedLive
                    ? `記錄 — ${String(selectedLive.zone)}`
                    : '記錄（請先在「區域」選取）'
                }
              >
                {selectedLive ? (
                  <>
                    <p className="muted u-text-sm">
                      狀態 <ResourceStatusBadge status={String(selectedLive.apply_status)} />
                      {selectedLive.zonePath ? (
                        <>
                          {' '}
                          · <code className="inline">{String(selectedLive.zonePath)}</code>
                        </>
                      ) : null}
                    </p>
                    <FormActions>
                      <button
                        type="button"
                        className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                        onClick={() => {
                          setEditRec(null);
                          setRtype('A');
                          setRname('@');
                          setRvalue(String(selectedLive.serverIp ?? ''));
                          setRttl(String(selectedLive.ttl ?? 300));
                          setRecOpen(true);
                        }}
                      >
                        + 新增記錄
                      </button>
                      <button
                        type="button"
                        className={buttonClassName({ variant: 'primary', size: 'sm' })}
                        disabled={zones.busy}
                        onClick={() => void zones.apply(selectedLive.id)}
                      >
                        寫入區域檔
                      </button>
                      <Link
                        to={`/ssl?domain=${encodeURIComponent(String(selectedLive.zone))}&action=le`}
                        className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                        title={`申請 ${String(selectedLive.zone)} Let’s Encrypt`}
                      >
                        申請本區域 SSL
                      </Link>
                    </FormActions>

                    <div className="u-mt-4">
                      <h3 className="section-block__title">SOA / 預設 TTL</h3>
                      <p className="section-block__desc">
                        寫入 zone 檔時的 SOA 名稱伺服器與 $TTL；儲存後請再「寫入區域檔」才落到磁碟
                      </p>
                      <FormLayout columns={2}>
                        <Field
                          label="SOA 名稱伺服器"
                          htmlFor="edit-soa-ns"
                          flush
                          hint="可留空 → 預設 ns1.區域."
                        >
                          <input
                            id="edit-soa-ns"
                            value={editSoaNs}
                            onChange={(e) => setEditSoaNs(e.target.value)}
                            placeholder={`ns1.${String(selectedLive.zone)}.`}
                            spellCheck={false}
                            disabled={soaBusy || zones.busy}
                          />
                        </Field>
                        <Field label="預設 TTL（秒）" htmlFor="edit-soa-ttl" flush>
                          <PresetChips
                            options={[
                              { value: '60', label: '1 分' },
                              { value: '300', label: '5 分' },
                              { value: '600', label: '10 分' },
                              { value: '3600', label: '1 時' },
                              { value: '86400', label: '1 日' },
                            ]}
                            value={editSoaTtl}
                            onChange={setEditSoaTtl}
                            allowCustom
                            customPlaceholder="自訂秒數"
                            disabled={soaBusy || zones.busy}
                          />
                        </Field>
                      </FormLayout>
                      <FormActions align="end">
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={soaBusy}
                          disabled={zones.busy}
                          onClick={() => {
                            void (async () => {
                              setSoaBusy(true);
                              setSoaMsg(null);
                              try {
                                const ttl = Number(editSoaTtl) || 300;
                                await zones.update(selectedLive.id, {
                                  nsName: editSoaNs.trim() || undefined,
                                  ttl,
                                });
                                setSoaMsg('已儲存 SOA 設定（控制面）— 請「寫入區域檔」套用');
                              } catch (e) {
                                setSoaMsg(
                                  e instanceof Error ? e.message : '儲存 SOA 失敗',
                                );
                              } finally {
                                setSoaBusy(false);
                              }
                            })();
                          }}
                        >
                          儲存 SOA 設定
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          loading={soaBusy || zones.busy}
                          onClick={() => {
                            void (async () => {
                              setSoaBusy(true);
                              setSoaMsg(null);
                              try {
                                const ttl = Number(editSoaTtl) || 300;
                                await zones.update(selectedLive.id, {
                                  nsName: editSoaNs.trim() || undefined,
                                  ttl,
                                });
                                await zones.apply(selectedLive.id);
                                setSoaMsg('已儲存並寫入區域檔');
                              } catch (e) {
                                setSoaMsg(
                                  e instanceof Error ? e.message : 'SOA 寫入失敗',
                                );
                              } finally {
                                setSoaBusy(false);
                              }
                            })();
                          }}
                        >
                          儲存並寫入區域檔
                        </Button>
                      </FormActions>
                      {soaMsg ? (
                        <Alert
                          variant={
                            soaMsg.includes('失敗') ? 'error' : 'ok'
                          }
                        >
                          {soaMsg}
                        </Alert>
                      ) : null}
                    </div>

                    <DataTable
                      columns={[
                        { key: 'type', header: '類型', render: (r) => String(r.type) },
                        { key: 'name', header: '名稱', render: (r) => String(r.name) },
                        {
                          key: 'value',
                          header: '值',
                          render: (r) => (
                            <code className="inline u-break-all">{String(r.value)}</code>
                          ),
                        },
                        { key: 'ttl', header: 'TTL', render: (r) => String(r.ttl ?? 300) },
                      ]}
                      rows={records.items}
                  rowKey={(r) => String((r as { id?: string }).id ?? '')}
                      empty={<EmptyState title="尚無記錄" />}
                      rowActions={(r) => (
                        <ActionBar>
                          <button
                            type="button"
                            className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                            onClick={() => {
                              setEditRec(r);
                              setRtype(String(r.type ?? 'A'));
                              setRname(String(r.name ?? '@'));
                              setRvalue(String(r.value ?? ''));
                              setRttl(String(r.ttl ?? 300));
                              setRecOpen(true);
                            }}
                          >
                            編輯
                          </button>
                          <button
                            type="button"
                            className={buttonClassName({ variant: 'danger', size: 'sm' })}
                            onClick={() => setDelRec(r.id)}
                          >
                            刪除
                          </button>
                        </ActionBar>
                      )}
                    />
                  </>
                ) : (
                  <EmptyState
                    title="尚未選擇區域"
                    description="到「區域」分頁點選一個 zone"
                    action={
                      <button type="button" className={buttonClassName({ variant: 'secondary', size: 'md' })} onClick={() => setTab('zones')}>
                        前往區域
                      </button>
                    }
                  />
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'cluster' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="DNS 叢集"
                description="SCP 推送 zone 檔後可 remote reload（rndc / named / bind9 / pdns）。written ≠ applied。"
              >
                <FormLayout columns={2}>
                  <Field
                    label="Peer 主機"
                    htmlFor="peer-h"
                    flush
                    required
                    hint="次要 NS 主機名稱或 IP（需 SSH 金鑰登入）"
                  >
                    <input
                      id="peer-h"
                      value={peerHost}
                      onChange={(e) => setPeerHost(e.target.value)}
                      placeholder="ns2.example.com"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    label="SSH 用戶"
                    htmlFor="peer-u"
                    flush
                    hint="需有目標路徑寫入與 reload 權限"
                  >
                    <input
                      id="peer-u"
                      value={peerUser}
                      onChange={(e) => setPeerUser(e.target.value)}
                      placeholder="root"
                    />
                  </Field>
                  <Field
                    label="標籤（可選）"
                    htmlFor="peer-label"
                    flush
                    hint="例如 ns2 / hkg-edge-dns"
                  >
                    <input
                      id="peer-label"
                      value={peerLabel}
                      onChange={(e) => setPeerLabel(e.target.value)}
                      placeholder="ns2"
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void refreshPeers()}
                    disabled={clusterBusy}
                  >
                    重新整理
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={clusterBusy}
                    disabled={!peerHost.trim()}
                    onClick={() =>
                      void api
                        .requestRaw('/api/v1/dns/cluster/peers', {
                          method: 'POST',
                          body: JSON.stringify({
                            host: peerHost.trim(),
                            username: peerUser.trim() || 'root',
                            path: '/var/lib/ysk/dns/zones',
                            label: peerLabel.trim() || undefined,
                          }),
                        })
                        .then(() => {
                          setPeerHost('');
                          setPeerLabel('');
                          return refreshPeers();
                        })
                        .catch((e: Error) => setClusterMsg(e.message))
                    }
                  >
                    新增 peer
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={clusterBusy}
                    disabled={!peers.length}
                    onClick={() =>
                      void runClusterOp('/api/v1/dns/cluster/push', {
                        reload: true,
                      })
                    }
                  >
                    推送 + reload
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={clusterBusy}
                    disabled={!peers.length}
                    onClick={() =>
                      void runClusterOp('/api/v1/dns/cluster/push', {
                        reload: false,
                      })
                    }
                  >
                    僅推送（不 reload）
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={clusterBusy}
                    disabled={!peers.length}
                    onClick={() =>
                      void runClusterOp('/api/v1/dns/cluster/reload', {})
                    }
                  >
                    僅 remote reload
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={clusterBusy}
                    disabled={!peers.length}
                    onClick={() =>
                      void runClusterOp('/api/v1/dns/cluster/probe', {})
                    }
                  >
                    探活 peers
                  </Button>
                </FormActions>
                <FormHint>
                  預設「推送 + reload」：scp 成功後以 SSH 執行 rndc reload 或
                  systemctl reload named|bind9|pdns。需本機已開啟系統變更權限，且
                  control → peer 可用 BatchMode SSH。
                </FormHint>
              </CardSection>
            </Card>

            {clusterMsg ? (
              <Alert
                variant={
                  /封鎖|失敗|未全部|partial|failed/i.test(clusterMsg)
                    ? 'error'
                    : 'ok'
                }
              >
                {clusterMsg}
                {clusterApplyStatus ? (
                  <p className="u-mt-1 muted u-text-sm">
                    apply_status：<code className="inline">{clusterApplyStatus}</code>
                  </p>
                ) : null}
                {clusterNotes.length ? (
                  <ul className="list-plain u-mt-2">
                    {clusterNotes.map((n) => (
                      <li key={n} className="muted u-text-sm">
                        {n}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Alert>
            ) : null}

            {clusterPeerResults.length > 0 ? (
              <Card>
                <CardSection title="本次操作（每 peer）">
                  <ul className="list-plain list-spaced">
                    {clusterPeerResults.map((pr) => (
                      <li key={String(pr.peerId)}>
                        <strong>
                          {String(pr.label || pr.host)} ·{' '}
                          <code className="inline">
                            {String(pr.apply_status ?? '—')}
                          </code>
                        </strong>
                        {pr.reloaded === true ? (
                          <span className="muted u-text-sm">
                            {' '}
                            reload={String(pr.reloadMethod ?? 'ok')}
                          </span>
                        ) : null}
                        {Array.isArray(pr.notes) ? (
                          <ul className="list-plain u-mt-1">
                            {(pr.notes as string[]).map((n) => (
                              <li key={n} className="muted u-text-sm">
                                {n}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </CardSection>
              </Card>
            ) : null}

            <Card>
              <CardSection
                title={`已登記 peers（${peers.length}）`}
                description="lastProbe 於「探活」或推送後更新"
              >
                {peers.length === 0 ? (
                  <EmptyState title="尚未登記任何 peer" />
                ) : (
                  <ul className="list-plain list-spaced">
                    {peers.map((p) => {
                      const lp = p.lastProbe as
                        | {
                            ok?: boolean;
                            service?: string;
                            zoneDirOk?: boolean;
                            at?: string;
                            notes?: string[];
                          }
                        | undefined;
                      return (
                        <li key={String(p.id)} className="u-flex u-flex-col gap-1">
                          <div>
                            <code className="inline">
                              {p.label ? `${String(p.label)} · ` : ''}
                              {String(p.username)}@{String(p.host)}:
                              {String(p.path)}
                            </code>
                          </div>
                          {lp ? (
                            <p className="muted u-text-sm">
                              探活：{lp.ok ? 'healthy' : 'unhealthy'}
                              {lp.service ? ` · ${lp.service}` : ''}
                              {lp.zoneDirOk === false
                                ? ' · zone 目錄缺失'
                                : ''}
                              {lp.at
                                ? ` · ${new Date(lp.at).toLocaleString()}`
                                : ''}
                            </p>
                          ) : (
                            <p className="muted u-text-sm">尚未探活</p>
                          )}
                          <FormActions>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={clusterBusy}
                              onClick={() =>
                                void runClusterOp(
                                  '/api/v1/dns/cluster/push',
                                  {
                                    peerId: String(p.id),
                                    reload: true,
                                  },
                                )
                              }
                            >
                              推送+reload
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={clusterBusy}
                              onClick={() =>
                                void runClusterOp(
                                  '/api/v1/dns/cluster/reload',
                                  { peerId: String(p.id) },
                                )
                              }
                            >
                              reload
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={clusterBusy}
                              onClick={() =>
                                void runClusterOp(
                                  '/api/v1/dns/cluster/probe',
                                  { peerId: String(p.id) },
                                )
                              }
                            >
                              探活
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={clusterBusy}
                              onClick={() =>
                                void api
                                  .requestRaw(
                                    `/api/v1/dns/cluster/peers/${encodeURIComponent(String(p.id))}`,
                                    { method: 'DELETE' },
                                  )
                                  .then(() => refreshPeers())
                                  .catch((e: Error) =>
                                    setClusterMsg(e.message),
                                  )
                              }
                            >
                              刪除
                            </Button>
                          </FormActions>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'dnssec' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="DNSSEC"
                description="產生金鑰；不自動上線"
              >
                {selectedLive ? (
                  <>
                    <p className="muted u-text-sm">
                      目前區域：<strong>{String(selectedLive.zone)}</strong>
                    </p>
                    <FormHint>
                      產生金鑰／DS；若 dataDir 有 zone 檔會嘗試 dnssec-signzone。DS
                      唔會自動上 registrar。
                    </FormHint>
                    <FormActions>
                      <Button
                        variant="primary"
                        size="md"
                        loading={dnssecBusy}
                        onClick={() => void onDnssec(String(selectedLive.zone))}
                      >
                        產生金鑰並嘗試簽署 zone
                      </Button>
                    </FormActions>
                  </>
                ) : (
                  <EmptyState
                    title="請先選擇區域"
                    action={
                      <button type="button" className={buttonClassName({ variant: 'secondary', size: 'md' })} onClick={() => setTab('zones')}>
                        前往區域
                      </button>
                    }
                  />
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'tools' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="DNS 查詢（dig）"
                description="對公網解析器查詢；用於驗證 multi-A / CDN 是否生效。唔假造答案。"
              >
                <form onSubmit={(e) => void onLookup(e)}>
                  <FormLayout columns={2}>
                    <Field
                      label="名稱"
                      htmlFor="lookup-name"
                      flush
                      required
                      hint="例如 example.com 或 www.example.com"
                    >
                      <input
                        id="lookup-name"
                        value={lookupName}
                        onChange={(e) => setLookupName(e.target.value)}
                        placeholder={
                          selectedLive
                            ? String(selectedLive.zone ?? 'example.com')
                            : 'example.com'
                        }
                        spellCheck={false}
                        required
                      />
                    </Field>
                    <Field label="類型" htmlFor="lookup-type" flush>
                      <SegRadio
                        name="lookup-type"
                        aria-label="查詢類型"
                        value={lookupType}
                        onChange={setLookupType}
                        options={['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'NS'].map(
                          (t) => ({ value: t, label: t }),
                        )}
                      />
                    </Field>
                  </FormLayout>
                  <FormActions>
                    <Button
                      type="submit"
                      variant="primary"
                      size="md"
                      loading={lookupBusy}
                    >
                      查詢
                    </Button>
                    {selectedLive ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        onClick={() => {
                          setLookupName(String(selectedLive.zone ?? ''));
                          setLookupType('A');
                        }}
                      >
                        填入目前區域
                      </Button>
                    ) : null}
                  </FormActions>
                </form>
                <FormHint>
                  優先使用主機上的 dig；若無 dig 則 fallback 至 node dns。結果反映查詢當下解析器所見，唔等於 panel 內記錄。
                </FormHint>
              </CardSection>
            </Card>
            {lookupResult ? (
              <Card>
                <CardSection
                  title={
                    lookupResult.ok
                      ? `查詢結果（${lookupResult.answers.length} 筆）`
                      : '查詢無答案／失敗'
                  }
                  description={
                    [
                      lookupResult.method
                        ? `方法：${lookupResult.method}`
                        : null,
                      lookupResult.latencyMs != null
                        ? `${lookupResult.latencyMs} ms`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined
                  }
                >
                  {lookupResult.answers.length ? (
                    <ul className="notes-list">
                      {lookupResult.answers.map((a) => (
                        <li key={a}>
                          <code className="inline">{a}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title="沒有答案" description="NXDOMAIN、空 RRset 或解析失敗" />
                  )}
                  {lookupResult.notes.length ? (
                    <ul className="list-plain u-mt-2">
                      {lookupResult.notes.map((n) => (
                        <li key={n} className="muted u-text-sm">
                          {n}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <Alert
                    variant={lookupResult.ok ? 'ok' : 'error'}
                    className="u-mt-2"
                  >
                    {lookupResult.ok
                      ? '以上為即時查詢結果。CDN multi-A 應看到多個 IP；健康摘除後應減少。'
                      : '查詢失敗或無答案。請確認名稱、類型與上游解析器。'}
                  </Alert>
                </CardSection>
              </Card>
            ) : null}
            <Card>
              <CardSection
                title="記錄驗證"
                description="新增／編輯記錄時會自動呼叫 /api/v1/dns/validate（CNAME 衝突、A/AAAA 格式等）。"
              >
                <FormHint>
                  儲存前若有 error 級問題會擋下；warn（例如 apex CNAME）只提示。CDN 模組日後會用同一驗證器保護 managedBy=cdn 的 RRset。
                </FormHint>
              </CardSection>
            </Card>
          </div>
        ) : null}
      </PageTabs>

      <Modal
        open={zoneOpen}
        onClose={() => setZoneOpen(false)}
        title="建立 DNS 區域"
        description="依模板產生記錄"
        footer={
          <>
            <button type="button" className={buttonClassName({ variant: 'secondary', size: 'md' })} onClick={() => setZoneOpen(false)}>
              取消
            </button>
            <button type="submit" form="dz" className={buttonClassName({ variant: 'primary', size: 'md' })} disabled={zones.busy}>
              建立
            </button>
          </>
        }
      >
        <form id="dz" onSubmit={(e) => void onCreateZone(e)}>
          <FormLayout columns={2}>
            <Field
              label="區域名稱"
              htmlFor="z"
              flush
              required
              hint="例如 example.com（不含結尾點）"
            >
              <input
                id="z"
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                required
                placeholder="example.com"
                spellCheck={false}
              />
            </Field>
            <Field
              label="伺服器 IPv4"
              htmlFor="sip"
              flush
              required
              hint="模板 A 記錄使用的位址"
            >
              <input
                id="sip"
                value={serverIp}
                onChange={(e) => setServerIp(e.target.value)}
                required
                placeholder="此主機公網 IPv4"
                spellCheck={false}
              />
            </Field>
            <Field
              label="伺服器 IPv6（可選）"
              htmlFor="sip6"
              flush
              hint="有公網 v6 時寫入 AAAA；可留空"
            >
              <input
                id="sip6"
                value={serverIpv6}
                onChange={(e) => setServerIpv6(e.target.value)}
                placeholder="此主機公網 IPv6（可留空）"
                spellCheck={false}
              />
            </Field>
            <Field
              label="SOA 名稱伺服器"
              htmlFor="soa-ns"
              flush
              hint="可留空，預設 ns1.區域名稱"
            >
              <input
                id="soa-ns"
                value={soaNs}
                onChange={(e) => setSoaNs(e.target.value)}
                placeholder="ns1.example.com."
                spellCheck={false}
              />
            </Field>
            <Field label="預設 TTL" htmlFor="soa-ttl" flush hint="SOA 與新記錄預設">
              <PresetChips
                options={[
                  { value: '60', label: '1 分' },
                  { value: '300', label: '5 分' },
                  { value: '600', label: '10 分' },
                  { value: '3600', label: '1 時' },
                  { value: '86400', label: '1 日' },
                ]}
                value={soaTtl}
                onChange={setSoaTtl}
                allowCustom
                customPlaceholder="自訂秒數"
              />
            </Field>
            <Field label="記錄模板" htmlFor="ztpl" fullWidth flush>
              <SegRadio
                name="ztpl"
                aria-label="記錄模板"
                value={template}
                onChange={(v) => setTemplate(v as (typeof ZONE_TEMPLATES)[number]['id'])}
                options={ZONE_TEMPLATES.map((t) => ({
                  value: t.id,
                  label: t.label,
                }))}
              />
            </Field>
          </FormLayout>
          <FormHint>建立後請在「記錄」分頁檢視並「寫入區域檔」才會落到磁碟。</FormHint>
        </form>
      </Modal>

      <Modal
        open={recOpen}
        onClose={() => setRecOpen(false)}
        title={editRec ? '編輯記錄' : '新增記錄'}
        description={
          selectedLive ? `區域 ${String(selectedLive.zone)} · 儲存後需再寫入區域檔` : undefined
        }
        footer={
          <>
            <button type="button" className={buttonClassName({ variant: 'secondary', size: 'md' })} onClick={() => setRecOpen(false)}>
              取消
            </button>
            <button type="submit" form="dr" className={buttonClassName({ variant: 'primary', size: 'md' })} disabled={records.busy}>
              儲存
            </button>
          </>
        }
      >
        <form id="dr" onSubmit={(e) => void onSaveRec(e)}>
          <FormLayout columns={2}>
            <Field label="類型" htmlFor="rt" flush required>
              <SegRadio
                name="rt"
                aria-label="DNS 記錄類型"
                value={rtype}
                onChange={setRtype}
                options={['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'].map((t) => ({
                  value: t,
                  label: t,
                }))}
              />
            </Field>
            <Field
              label="名稱"
              htmlFor="rn"
              flush
              required
              hint="@ = 根網域；www = 子網域"
            >
              <input
                id="rn"
                value={rname}
                onChange={(e) => setRname(e.target.value)}
                required
                placeholder="@"
                spellCheck={false}
              />
            </Field>
            <Field
              label="值"
              htmlFor="rv"
              fullWidth
              flush
              required
              hint={
                rtype === 'MX'
                  ? '例如 10 mail.example.com.'
                  : rtype === 'TXT'
                    ? '例如 v=spf1 a mx ip4:… ip6:… ~all'
                    : rtype === 'AAAA'
                      ? '請填 IPv6 位址'
                      : rtype === 'A'
                        ? '請填 IPv4 位址'
                        : 'IP、主機名或對應內容'
              }
            >
              <input
                id="rv"
                value={rvalue}
                onChange={(e) => setRvalue(e.target.value)}
                required
                placeholder={
                  rtype === 'AAAA'
                    ? 'IPv6 位址'
                    : rtype === 'A'
                      ? 'IPv4 位址'
                      : undefined
                }
                spellCheck={false}
              />
            </Field>
            <Field label="TTL" htmlFor="ttl" flush hint="快取時間">
              <PresetChips
                options={[
                  { value: '60', label: '1 分' },
                  { value: '300', label: '5 分' },
                  { value: '600', label: '10 分' },
                  { value: '3600', label: '1 時' },
                  { value: '86400', label: '1 日' },
                ]}
                value={rttl}
                onChange={setRttl}
                allowCustom
                customPlaceholder="自訂秒數"
              />
            </Field>
          </FormLayout>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(delZone)}
        onClose={() => setDelZone(null)}
        onConfirm={() => {
          if (delZone)
            void zones.remove(delZone).then(() => {
              if (selectedZone?.id === delZone) setSelectedZone(null);
              setDelZone(null);
            });
        }}
        title="刪除區域？"
        description="會一併刪除其 DNS 記錄登記。"
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={zones.busy}
      />
      <ConfirmDialog
        open={Boolean(delRec)}
        onClose={() => setDelRec(null)}
        onConfirm={() => {
          if (delRec) void records.remove(delRec).then(() => setDelRec(null));
        }}
        title="刪除記錄？"
        description="移除後請寫入區域檔"
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={records.busy}
      />
    </FeaturePageLayout>
  );
}
