import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormLayout,
  Modal,
  OpsHero,
  SoftwareInstallBanner,
  Tabs,
  FormActions,
  FormHint,
  PresetChips,
  SegRadio,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';

const DNS_TABS = ['zones', 'records', 'cluster', 'dnssec'] as const;
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
import { ResourceTable } from '../../shared/components/resource/ResourceTable';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import type { ResourceRow } from '../../features/resources/api';
import { api } from '../../shared/services/api';

const ZONE_TEMPLATES = [
  { id: 'minimal', label: '最小 — 僅 apex A' },
  { id: 'web', label: '網站 — apex + www' },
  { id: 'mail', label: '郵件 — apex + mail + MX + SPF' },
  { id: 'full', label: '完整 — web + mail + ftp + SPF' },
] as const;

export function DnsPage() {
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
  const [peers, setPeers] = useState<Array<Record<string, unknown>>>([]);
  const [soaNs, setSoaNs] = useState('');
  const [soaTtl, setSoaTtl] = useState('300');

  // Keep selected zone row in sync after apply/refresh
  const selectedLive = useMemo(() => {
    if (!selectedZone) return null;
    return zones.items.find((z) => z.id === selectedZone.id) ?? selectedZone;
  }, [zones.items, selectedZone]);

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
          ? '已產生 DNSSEC 金鑰（written ≠ 已簽署／已上線）'
          : 'DNSSEC 產生未完成',
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

  async function onSaveRec(e: FormEvent) {
    e.preventDefault();
    if (!selectedZone) return;
    const val = rvalue.trim();
    if (rtype === 'A' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(val)) {
      alert('A 記錄值必須是 IPv4（請填伺服器公網 IPv4）');
      return;
    }
    if (rtype === 'AAAA' && !(val.includes(':') && val.length >= 2 && val.length < 46)) {
      alert('AAAA 記錄值必須是 IPv6（請填伺服器公網 IPv6）');
      return;
    }
    const body = {
      zoneId: selectedZone.id,
      type: rtype,
      name: rname,
      value: val,
      ttl: Number(rttl) || 300,
    };
    if (editRec) await records.update(editRec.id, body);
    else await records.create(body);
    setRecOpen(false);
    setEditRec(null);
    setRvalue('');
  }

  const [tab, setTab] = usePageTab(DNS_TABS, 'zones');

  return (
    <FeaturePageLayout
      title="DNS 區域"
      subtitle="管理 zone 檔（寫入 ≠ 權威 DNS 已上線）"
      showCapability={false}
      actions={
        <>
          <Button variant="primary" size="md" onClick={() => setZoneOpen(true)}>
            + 建立區域
          </Button>
          <Link to="/ssl" className="btn btn--ghost btn--md">
            SSL
          </Link>
        </>
      }
    >
      <SoftwareInstallBanner feature="dns" title="DNS 所需軟件尚未安裝" />
      <OpsHero
        eyebrow="DNS"
        title="區域與紀錄"
        pill={`${zones.items.length} zones`}
        pillTone={zones.items.length ? 'ok' : 'warn'}
        tone={zones.items.length ? 'ok' : 'warn'}
        hint="面板寫入 zone 素材；權威伺服器上線／註冊商 NS 仍需運維確認。written ≠ 互聯網已解析。"
        cta={
          <>
            <Button variant="primary" size="md" onClick={() => setZoneOpen(true)}>
              + 建立區域
            </Button>
            <Button variant="secondary" size="md" onClick={() => setTab('records')}>
              紀錄
            </Button>
            <Button variant="ghost" size="md" onClick={() => setTab('dnssec')}>
              DNSSEC
            </Button>
          </>
        }
        stats={[
          { label: 'Zones', value: zones.items.length },
          {
            label: '紀錄',
            value: records.items.length,
          },
          { label: 'Peers', value: peers.length },
          {
            label: '選中',
            value: selectedLive ? String(selectedLive.zone ?? selectedLive.id) : '—',
          },
        ]}
        rail={
          <li>
            <span className="ops-rail__k">誠實</span>
            <Badge tone="neutral">written ≠ live DNS</Badge>
          </li>
        }
      />
      {zones.error || records.error ? (
        <Alert variant="error">{zones.error ?? records.error}</Alert>
      ) : null}
      {zones.msg ? (
        <Alert variant="ok">
          {zones.msg}{' '}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => zones.setMsg(null)}>
            關閉
          </button>
        </Alert>
      ) : null}
      {dnssecMsg ? (
        <Alert variant={dnssecMsg.includes('失敗') || dnssecMsg.includes('未完成') ? 'error' : 'ok'}>
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
      <Tabs
        tabs={[
          { id: 'zones', label: '區域', badge: zones.items.length || undefined },
          {
            id: 'records',
            label: '記錄',
            badge: selectedLive ? records.items.length || undefined : undefined,
          },
          { id: 'cluster', label: '叢集', badge: peers.length || undefined },
          { id: 'dnssec', label: 'DNSSEC' },
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
            <Card>
              <CardSection title={`區域 (${zones.items.length})`}>
                <ResourceTable
                  columns={[
                    {
                      key: 'zone',
                      header: '區域名稱',
                      render: (r) => (
                        <button
                          type="button"
                          className="btn btn--link"
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
                      description="用右上角「建立區域」新增"
                    />
                  }
                  rowActions={(r) => (
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={zones.busy}
                        onClick={() => void zones.apply(r.id)}
                        title="寫入管理 zone 檔；有權限時 named-checkzone + 嘗試 reload"
                      >
                        寫入／套用
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => {
                          setSelectedZone(r);
                          setTab('records');
                        }}
                      >
                        記錄
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={zones.busy}
                        onClick={() => setDelZone(r.id)}
                      >
                        刪除
                      </button>
                    </div>
                  )}
                />
              </CardSection>
            </Card>
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
                        className="btn btn--secondary btn--sm"
                        onClick={() => {
                          setEditRec(null);
                          setRtype('A');
                          setRname('@');
                          setRvalue(String(selectedLive.serverIp ?? ''));
                          setRttl('300');
                          setRecOpen(true);
                        }}
                      >
                        + 新增記錄
                      </button>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={zones.busy}
                        onClick={() => void zones.apply(selectedLive.id)}
                      >
                        寫入區域檔
                      </button>
                      <Link
                        to={`/ssl?domain=${encodeURIComponent(String(selectedLive.zone))}&action=le`}
                        className="btn btn--ghost btn--sm"
                        title={`申請 ${String(selectedLive.zone)} Let’s Encrypt`}
                      >
                        申請本區域 SSL
                      </Link>
                    </FormActions>
                    <ResourceTable
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
                      empty={<EmptyState title="尚無記錄" />}
                      rowActions={(r) => (
                        <div className="btn-row">
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
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
                            className="btn btn--danger btn--sm"
                            onClick={() => setDelRec(r.id)}
                          >
                            刪除
                          </button>
                        </div>
                      )}
                    />
                  </>
                ) : (
                  <EmptyState
                    title="尚未選擇區域"
                    description="到「區域」分頁點選一個 zone"
                    action={
                      <button type="button" className="btn btn--secondary" onClick={() => setTab('zones')}>
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
                description="以 SCP 推送區域檔到 peer；寫入 peer ≠ named 已 reload"
              >
                <FormLayout columns={2}>
                  <Field
                    label="Peer 主機"
                    htmlFor="peer-h"
                    flush
                    required
                    hint="次要 NS 主機名稱或 IP"
                  >
                    <input
                      id="peer-h"
                      value={peerHost}
                      onChange={(e) => setPeerHost(e.target.value)}
                      placeholder="ns2.example.com"
                    />
                  </Field>
                  <Field label="SSH 用戶" htmlFor="peer-u" flush hint="需有目標路徑寫入權限">
                    <input
                      id="peer-u"
                      value={peerUser}
                      onChange={(e) => setPeerUser(e.target.value)}
                      placeholder="ysk"
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button variant="secondary" size="sm" onClick={() => void refreshPeers()}>
                    重新整理
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      void api
                        .requestRaw('/api/v1/dns/cluster/peers', {
                          method: 'POST',
                          body: JSON.stringify({
                            host: peerHost,
                            username: peerUser,
                            path: '/var/lib/ysk/dns/zones',
                          }),
                        })
                        .then(() => refreshPeers())
                        .catch((e: Error) => zones.setMsg?.(e.message))
                    }
                  >
                    新增 peer
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void api
                        .requestRaw('/api/v1/dns/cluster/push', {
                          method: 'POST',
                          body: '{}',
                        })
                        .then((r) => {
                          const notes = (r as { notes?: string[] }).notes;
                          setDnssecMsg(notes?.join('；') ?? '已推送');
                        })
                        .catch((e: Error) => setDnssecMsg(e.message))
                    }
                  >
                    推送到 peers
                  </Button>
                </FormActions>
                {peers.length === 0 ? (
                  <p className="muted u-text-sm u-mt-2">尚未登記任何 peer</p>
                ) : (
                  <ul className="list-plain list-spaced u-mt-2">
                    {peers.map((p) => (
                      <li key={String(p.id)}>
                        <code className="inline">
                          {String(p.username)}@{String(p.host)}:{String(p.path)}
                        </code>
                      </li>
                    ))}
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
                description="產生金鑰到 dataDir；唔會自動簽署 zone 或上線（誠實 written ≠ applied）"
              >
                {selectedLive ? (
                  <>
                    <p className="muted u-text-sm">
                      目前區域：<strong>{String(selectedLive.zone)}</strong>
                    </p>
                    <FormHint>
                      金鑰寫入 dataDir；不會自動簽署 zone 或更新 registrar DS。
                    </FormHint>
                    <FormActions>
                      <Button
                        variant="primary"
                        size="md"
                        loading={dnssecBusy}
                        onClick={() => void onDnssec(String(selectedLive.zone))}
                      >
                        產生 DNSSEC 金鑰
                      </Button>
                    </FormActions>
                  </>
                ) : (
                  <EmptyState
                    title="請先選擇區域"
                    action={
                      <button type="button" className="btn btn--secondary" onClick={() => setTab('zones')}>
                        前往區域
                      </button>
                    }
                  />
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}
      </Tabs>

      <Modal
        open={zoneOpen}
        onClose={() => setZoneOpen(false)}
        title="建立 DNS 區域"
        description="依模板產生種子記錄；寫入後狀態誠實標示（written ≠ 權威已上線）"
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setZoneOpen(false)}>
              取消
            </button>
            <button type="submit" form="dz" className="btn btn--primary" disabled={zones.busy}>
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
            <button type="button" className="btn btn--secondary" onClick={() => setRecOpen(false)}>
              取消
            </button>
            <button type="submit" form="dr" className="btn btn--primary" disabled={records.busy}>
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
        description="從控制面移除；請再「寫入區域檔」。"
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={records.busy}
      />
    </FeaturePageLayout>
  );
}
