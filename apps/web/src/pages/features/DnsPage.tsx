import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormGrid,
  Modal,
  SoftwareInstallBanner,
} from '../../shared/components/ui';
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
  const [serverIp, setServerIp] = useState('203.0.113.10');
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
      backend: 'bind',
      template,
      nsName: soaNs.trim() || undefined,
      ttl: Number(soaTtl) || 300,
    });
    setZoneOpen(false);
    setSelectedZone(item);
    setZone('');
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
    const body = {
      zoneId: selectedZone.id,
      type: rtype,
      name: rname,
      value: rvalue,
      ttl: Number(rttl) || 300,
    };
    if (editRec) await records.update(editRec.id, body);
    else await records.create(body);
    setRecOpen(false);
    setEditRec(null);
    setRvalue('');
  }

  return (
    <FeaturePageLayout
      title="DNS 區域"
      subtitle="管理 zone 檔（寫入 ≠ 權威 DNS 已上線）"
      actions={
        <button type="button" className="btn btn--primary" onClick={() => setZoneOpen(true)}>
          + 建立 Zone
        </button>
      }
    >
      <SoftwareInstallBanner feature="dns" title="DNS 所需軟件尚未安裝" />
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

      <div className="grid">
        <Card>
          <CardSection title={`Zones (${zones.items.length})`}>
            <ResourceTable
              columns={[
                {
                  key: 'zone',
                  header: 'Zone',
                  render: (r) => (
                    <button
                      type="button"
                      className="btn btn--link"
                      onClick={() => setSelectedZone(r)}
                    >
                      <strong>{String(r.zone)}</strong>
                    </button>
                  ),
                },
                { key: 'ip', header: 'Server IP', render: (r) => String(r.serverIp ?? '—') },
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
                  title="尚未有 DNS zone"
                  action={
                    <button type="button" className="btn btn--primary" onClick={() => setZoneOpen(true)}>
                      + 建立 Zone
                    </button>
                  }
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

        <Card>
          <CardSection
            title={
              selectedLive
                ? `Records — ${String(selectedLive.zone)}`
                : 'Records（先選 zone）'
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
                <div className="form-actions btn-row">
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => {
                      setEditRec(null);
                      setRtype('A');
                      setRname('@');
                      setRvalue(String(selectedLive.serverIp ?? ''));
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
                    寫入 zone file
                  </button>
                  <Link
                    to={`/ssl?domain=${encodeURIComponent(String(selectedLive.zone))}&action=le`}
                    className="btn btn--ghost btn--sm"
                    title={`申請 ${String(selectedLive.zone)} Let’s Encrypt`}
                  >
                    申請本 zone SSL
                  </Link>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={dnssecBusy}
                    onClick={() => void onDnssec(String(selectedLive.zone))}
                    title="產生 DNSSEC 金鑰到 dataDir；唔會自動簽署 zone 或上線"
                  >
                    產生 DNSSEC 金鑰
                  </Button>
                </div>
                <ResourceTable
                  columns={[
                    { key: 'type', header: 'Type', render: (r) => String(r.type) },
                    { key: 'name', header: 'Name', render: (r) => String(r.name) },
                    {
                      key: 'value',
                      header: 'Value',
                      render: (r) => (
                        <code className="inline u-break-all">{String(r.value)}</code>
                      ),
                    },
                    { key: 'ttl', header: 'TTL', render: (r) => String(r.ttl ?? 300) },
                  ]}
                  rows={records.items}
                  empty={<EmptyState title="無記錄" />}
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
              <p className="muted">喺左表點選 zone 以管理 records</p>
            )}
          </CardSection>
        </Card>
      </div>

      <Card>
        <CardSection
          title="DNS Cluster"
          description="peer scp zone 檔；written on peer ≠ named reload"
        >
          <div className="btn-row u-mb-3">
            <Button variant="secondary" size="sm" onClick={() => void refreshPeers()}>
              重新整理 peers
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
              推送 zones 到 peers
            </Button>
          </div>
          <FormGrid>
            <Field label="Peer host" htmlFor="peer-h" flush>
              <input
                id="peer-h"
                value={peerHost}
                onChange={(e) => setPeerHost(e.target.value)}
                placeholder="ns2.example.com"
              />
            </Field>
            <Field label="SSH user" htmlFor="peer-u" flush>
              <input
                id="peer-u"
                value={peerUser}
                onChange={(e) => setPeerUser(e.target.value)}
              />
            </Field>
          </FormGrid>
          <ul className="list-plain list-spaced u-mt-2">
            {peers.map((p) => (
              <li key={String(p.id)}>
                <code className="inline">
                  {String(p.username)}@{String(p.host)}:{String(p.path)}
                </code>
              </li>
            ))}
          </ul>
        </CardSection>
      </Card>

      <Modal
        open={zoneOpen}
        onClose={() => setZoneOpen(false)}
        title="建立 DNS Zone"
        description="依模板種子記錄；可設 SOA NS / TTL；寫入後狀態誠實標示"
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
          <FormGrid>
            <Field label="區域" techKey="zone" htmlFor="z">
              <input id="z" value={zone} onChange={(e) => setZone(e.target.value)} required />
            </Field>
            <Field label="伺服器 IP" techKey="server_ip" htmlFor="sip">
              <input
                id="sip"
                value={serverIp}
                onChange={(e) => setServerIp(e.target.value)}
                required
              />
            </Field>
            <Field label="SOA NS（可空=ns1.zone）" techKey="ns" htmlFor="soa-ns">
              <input
                id="soa-ns"
                value={soaNs}
                onChange={(e) => setSoaNs(e.target.value)}
                placeholder="ns1.example.com."
              />
            </Field>
            <Field label="SOA / 預設 TTL" techKey="ttl" htmlFor="soa-ttl">
              <input
                id="soa-ttl"
                value={soaTtl}
                onChange={(e) => setSoaTtl(e.target.value)}
              />
            </Field>
            <Field label="記錄模板" techKey="template" htmlFor="ztpl">
              <select
                id="ztpl"
                value={template}
                onChange={(e) =>
                  setTemplate(e.target.value as (typeof ZONE_TEMPLATES)[number]['id'])
                }
              >
                {ZONE_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </FormGrid>
        </form>
      </Modal>

      <Modal
        open={recOpen}
        onClose={() => setRecOpen(false)}
        title={editRec ? '編輯記錄' : '新增記錄'}
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
          <FormGrid>
            <Field label="類型" techKey="type" htmlFor="rt">
              <select id="rt" value={rtype} onChange={(e) => setRtype(e.target.value)}>
                {['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="名稱" techKey="name" htmlFor="rn">
              <input id="rn" value={rname} onChange={(e) => setRname(e.target.value)} required />
            </Field>
            <Field label="值" techKey="value" htmlFor="rv">
              <input id="rv" value={rvalue} onChange={(e) => setRvalue(e.target.value)} required />
            </Field>
            <Field label="TTL" techKey="ttl" htmlFor="ttl">
              <input id="ttl" value={rttl} onChange={(e) => setRttl(e.target.value)} />
            </Field>
          </FormGrid>
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
        title="刪除 Zone？"
        description="會一併刪除其 DNS records 登記。"
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
        description="從控制面移除；請再「寫入 zone file」。"
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={records.busy}
      />
    </FeaturePageLayout>
  );
}
