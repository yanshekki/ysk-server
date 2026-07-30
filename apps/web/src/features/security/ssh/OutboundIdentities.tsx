import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  EmptyState,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  Modal,
  SegRadio,
} from '../../../shared/components/ui';
import { sshApi } from './api';
import {
  nextAction,
  pipelineStep,
  purposeHint,
  purposeLabel,
  shortFingerprint,
  statusLabel,
  statusTone,
} from './labels';
import type { ProjectOpt, SshIdentityRow } from './types';

type Filter = 'active' | 'panel' | 'user' | 'retired' | 'all';

type Props = {
  onFlash: (tone: 'ok' | 'error', text: string) => void;
  onChanged: () => void;
};

export function OutboundIdentities({ onFlash, onChanged }: Props) {
  const [items, setItems] = useState<SshIdentityRow[]>([]);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // wizard
  const [wizOpen, setWizOpen] = useState(false);
  const [wizStep, setWizStep] = useState<1 | 2 | 3>(1);
  const [purpose, setPurpose] = useState<'panel_outbound' | 'user_outbound'>('panel_outbound');
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [installNow, setInstallNow] = useState(false);
  const [algo, setAlgo] = useState<'ed25519' | 'rsa-4096'>('ed25519');

  // reveal private one-time
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [revealFp, setRevealFp] = useState<string | null>(null);
  const [revealAck, setRevealAck] = useState(false);
  const [revealNextId, setRevealNextId] = useState<string | null>(null);

  // test modal
  const [testId, setTestId] = useState<string | null>(null);
  const [testTarget, setTestTarget] = useState('root@');

  // confirm
  const [confirm, setConfirm] = useState<
    null | { kind: 'delete' | 'rotate'; id: string; name: string }
  >(null);

  const refresh = useCallback(async () => {
    setLoadErr(null);
    const [ids, projs] = await Promise.all([sshApi.listIdentities(), sshApi.listProjects()]);
    setItems(ids.items ?? []);
    setProjects(projs);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setLoadErr(e.message));
  }, [refresh]);

  const filtered = useMemo(() => {
    let list = items;
    if (filter === 'active') list = list.filter((i) => i.status !== 'retired');
    if (filter === 'panel') list = list.filter((i) => i.purpose === 'panel_outbound');
    if (filter === 'user') list = list.filter((i) => i.purpose === 'user_outbound');
    if (filter === 'retired') list = list.filter((i) => i.status === 'retired');
    const qq = q.trim().toLowerCase();
    if (qq) {
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(qq) ||
          i.fingerprintSha256.toLowerCase().includes(qq) ||
          (i.binding?.linuxUser ?? '').toLowerCase().includes(qq),
      );
    }
    return list;
  }, [items, filter, q]);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  function openWizard() {
    setWizStep(1);
    setPurpose('panel_outbound');
    setProjectId(projects[0]?.id ?? '');
    setName('');
    setInstallNow(false);
    setAlgo('ed25519');
    setWizOpen(true);
  }

  function defaultName(): string {
    if (purpose === 'user_outbound') {
      const p = projects.find((x) => x.id === projectId);
      return p ? `${p.name}-outbound` : 'project-outbound';
    }
    return 'panel-peer';
  }

  async function submitCreate() {
    setBusy(true);
    try {
      const proj = projects.find((p) => p.id === projectId);
      const r = await sshApi.createIdentity({
        name: (name.trim() || defaultName()).slice(0, 64),
        algorithm: algo,
        purpose,
        revealPrivate: true,
        install: installNow,
        binding:
          purpose === 'user_outbound' && proj
            ? {
                projectId: proj.id,
                linuxUser: proj.linuxUser,
                homeDir: proj.homeDir,
              }
            : undefined,
      });
      if (!r.ok) {
        onFlash('error', (r.notes ?? []).join('；') || '建立失敗');
        return;
      }
      setWizOpen(false);
      if (r.privateKey) {
        setRevealKey(r.privateKey);
        setRevealFp(r.identity?.fingerprintSha256 ?? null);
        setRevealAck(false);
        setRevealNextId(r.identity?.id ?? null);
      }
      onFlash('ok', '身份已建立（私鑰只顯示一次）');
      await refresh();
      onChanged();
      if (r.identity) setSelectedId(r.identity.id);
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : '建立失敗');
    } finally {
      setBusy(false);
    }
  }

  async function runInstall(id: string) {
    setBusy(true);
    try {
      const r = await sshApi.install(id, true);
      onFlash(
        r.ok && r.applied ? 'ok' : r.blocked ? 'error' : 'ok',
        (r.notes ?? []).join('；') ||
          (r.applied
            ? '已寫入磁碟'
            : r.blocked
              ? '無法寫入系統：需開啟執行權限（YSK_EXECUTE）'
              : '未完成'),
      );
      await refresh();
      onChanged();
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : '安裝失敗');
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    if (!testId || !testTarget.trim()) return;
    setBusy(true);
    try {
      const r = await sshApi.test(testId, testTarget.trim(), true);
      onFlash(
        r.ok ? 'ok' : 'error',
        (r.notes ?? []).join('；') || (r.ok ? '連線通過' : '連線失敗'),
      );
      setTestId(null);
      await refresh();
      onChanged();
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : '測試失敗');
    } finally {
      setBusy(false);
    }
  }

  async function runPrimary(row: SshIdentityRow) {
    const act = nextAction(row.status, row.purpose);
    if (act.id === 'install') return runInstall(row.id);
    if (act.id === 'test') {
      setTestTarget(row.binding?.linuxUser ? `${row.binding.linuxUser}@` : 'root@');
      setTestId(row.id);
      return;
    }
    if (act.id === 'copy_pub') {
      void navigator.clipboard?.writeText(row.publicKey);
      onFlash('ok', '已複製公鑰 — 貼到對方 authorized_keys 或 Git 部署金鑰');
    }
  }

  async function confirmAction() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'delete') {
        await sshApi.remove(confirm.id, true);
        onFlash('ok', `已刪除「${confirm.name}」`);
        if (selectedId === confirm.id) setSelectedId(null);
      } else {
        const r = await sshApi.rotate(confirm.id, true);
        if (r.privateKey) {
          setRevealKey(r.privateKey);
          setRevealFp(r.newIdentity?.fingerprintSha256 ?? null);
          setRevealAck(false);
          setRevealNextId(r.newIdentity?.id ?? null);
        }
        onFlash('ok', '已輪替：舊金鑰退役，新金鑰已建立');
        if (r.newIdentity) setSelectedId(r.newIdentity.id);
      }
      setConfirm(null);
      await refresh();
      onChanged();
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : '操作失敗');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-gap">
      {loadErr ? <Alert variant="error">{loadErr}</Alert> : null}

      <Card>
        <CardSection
          title="出站身份金鑰"
          description="私鑰加密保存在控制面。列表永不顯示私鑰。寫入磁碟 ≠ 對方已授權你登入。"
        >
          <ActionBar className="u-mb-3 u-flex-wrap">
            <Button variant="primary" size="md" onClick={openWizard}>
              新增出站身份
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={busy}
              onClick={() => void refresh().catch((e: Error) => setLoadErr(e.message))}
            >
              重新整理
            </Button>
          </ActionBar>

          <div className="ssh-filters">
            {(
              [
                ['active', '使用中'],
                ['panel', '面板'],
                ['user', '專案用戶'],
                ['retired', '已退役'],
                ['all', '全部'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`ssh-filter${filter === id ? ' is-on' : ''}`}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
            <input
              className="ssh-filter-search"
              placeholder="搜尋名稱或 fingerprint…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="搜尋身份"
            />
          </div>
        </CardSection>
      </Card>

      <div className={`ssh-split${selected ? ' has-detail' : ''}`}>
        <Card className="ssh-split__list">
          <CardSection title={filtered.length ? `${filtered.length} 個身份` : '身份列表'}>
            {filtered.length === 0 ? (
              <EmptyState
                title={items.length === 0 ? '還沒有出站身份' : '沒有符合條件的項目'}
                description={
                  items.length === 0
                    ? '30 秒建立一把金鑰：選用途 → 命名 → 完成。之後可用於 peer / 備份 / git。'
                    : '試下改篩選或清空搜尋'
                }
                action={
                  items.length === 0 ? (
                    <Button variant="primary" size="md" onClick={openWizard}>
                      新增第一個出站身份
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="list-panel">
                {filtered.map((row) => {
                  const act = nextAction(row.status, row.purpose);
                  const on = selectedId === row.id;
                  return (
                    <div
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      className={`list-row${on ? ' is-selected' : ''}`}
                      onClick={() => setSelectedId(row.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedId(row.id);
                        }
                      }}
                    >
                      <div className="list-row__main">
                        <div className="list-row__title">
                          <span>{row.name}</span>
                          <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                          <Badge tone="neutral">{purposeLabel(row.purpose)}</Badge>
                        </div>
                        <div className="list-row__meta">
                          <span title={row.fingerprintSha256} className="u-font-mono">
                            {shortFingerprint(row.fingerprintSha256)}
                          </span>
                          {row.binding?.linuxUser ? (
                            <span>用戶 {row.binding.linuxUser}</span>
                          ) : null}
                          <span className="muted">{row.algorithm}</span>
                        </div>
                      </div>
                      <div className="list-row__side" onClick={(e) => e.stopPropagation()}>
                        {act.id !== 'none' ? (
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busy}
                            onClick={() => void runPrimary(row)}
                          >
                            {act.label}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardSection>
        </Card>

        {selected ? (
          <Card className="ssh-split__detail">
            <CardSection title={selected.name} description={purposeHint(selected.purpose)}>
              <ActionBar className="u-mb-3 u-justify-end">
                <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                  關閉
                </Button>
              </ActionBar>
              <StatusPipeline status={selected.status} />

              <dl className="ssh-facts">
                <div>
                  <dt>狀態</dt>
                  <dd>
                    <Badge tone={statusTone(selected.status)}>
                      {statusLabel(selected.status)}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt>用途</dt>
                  <dd>{purposeLabel(selected.purpose)}</dd>
                </div>
                <div>
                  <dt>Fingerprint</dt>
                  <dd className="u-font-mono u-break-all u-text-sm">
                    {selected.fingerprintSha256}
                  </dd>
                </div>
                {selected.binding?.linuxUser ? (
                  <div>
                    <dt>Linux 用戶</dt>
                    <dd>
                      {selected.binding.linuxUser}
                      {selected.binding.homeDir ? (
                        <div className="muted u-text-sm">{selected.binding.homeDir}</div>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
                {selected.install?.path ? (
                  <div>
                    <dt>磁碟路徑</dt>
                    <dd className="u-font-mono u-text-sm u-break-all">
                      {selected.install.path}
                    </dd>
                  </div>
                ) : null}
                {selected.lastVerifyNote ? (
                  <div>
                    <dt>最近測試</dt>
                    <dd className="u-text-sm">{selected.lastVerifyNote}</dd>
                  </div>
                ) : null}
              </dl>

              <FormHint>
                建議流程：入庫 → 寫入磁碟 → 把<strong>公鑰</strong>放到對方 → 測試連線
              </FormHint>

              <div className="ssh-detail-actions">
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() => void runPrimary(selected)}
                >
                  {nextAction(selected.status, selected.purpose).label || '複製公鑰'}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    void navigator.clipboard?.writeText(selected.publicKey);
                    onFlash('ok', '已複製公鑰');
                  }}
                >
                  複製公鑰
                </Button>
                {(selected.binding?.linuxUser || selected.binding?.projectId) &&
                selected.status !== 'retired' ? (
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() => {
                      setBusy(true);
                      void sshApi
                        .authorizeSelf(selected.id)
                        .then((r) => {
                          onFlash(
                            r.ok ? 'ok' : 'error',
                            (r.notes ?? []).join('；') ||
                              (r.ok ? '已把公鑰加入本機登入授權' : '失敗'),
                          );
                        })
                        .catch((e: Error) => onFlash('error', e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    允許本機用此鑰登入
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    setTestTarget(
                      selected.binding?.linuxUser
                        ? `${selected.binding.linuxUser}@`
                        : 'root@',
                    );
                    setTestId(selected.id);
                  }}
                >
                  測試連線…
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  disabled={selected.status === 'retired'}
                  onClick={() =>
                    setConfirm({ kind: 'rotate', id: selected.id, name: selected.name })
                  }
                >
                  輪替金鑰
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  onClick={() =>
                    setConfirm({ kind: 'delete', id: selected.id, name: selected.name })
                  }
                >
                  刪除
                </Button>
              </div>
            </CardSection>
          </Card>
        ) : null}
      </div>

      {/* —— Create wizard —— */}
      <Modal
        open={wizOpen}
        onClose={() => setWizOpen(false)}
        title={
          wizStep === 1
            ? '這把金鑰用來做什麼？'
            : wizStep === 2
              ? purpose === 'user_outbound'
                ? '綁定哪個專案？'
                : '確認面板出站'
              : '命名與選項'
        }
        description={
          wizStep === 1
            ? '選對用途，之後列表與安裝路徑會自動對齊'
            : wizStep === 2
              ? purpose === 'user_outbound'
                ? '金鑰會綁定該專案的 Linux 用戶與 home'
                : '私鑰只放在控制面 secrets，用於 scp／ssh 到其他主機'
              : '名稱方便你辨識；進階選項可稍後再改'
        }
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                if (wizStep === 1) setWizOpen(false);
                else setWizStep((s) => (s === 3 ? 2 : 1));
              }}
            >
              {wizStep === 1 ? '取消' : '上一步'}
            </Button>
            {wizStep < 3 ? (
              <Button
                variant="primary"
                size="md"
                disabled={wizStep === 2 && purpose === 'user_outbound' && !projectId}
                onClick={() => {
                  if (wizStep === 1) setWizStep(2);
                  else {
                    if (!name) setName(defaultName());
                    setWizStep(3);
                  }
                }}
              >
                下一步
              </Button>
            ) : (
              <Button variant="primary" size="md" loading={busy} onClick={() => void submitCreate()}>
                建立身份
              </Button>
            )}
          </>
        }
      >
        {wizStep === 1 ? (
          <div className="ssh-purpose-grid">
            <button
              type="button"
              className={`ssh-purpose-card${purpose === 'panel_outbound' ? ' is-on' : ''}`}
              onClick={() => setPurpose('panel_outbound')}
            >
              <strong>面板連其他機</strong>
              <span>Cluster peer、遠端備份、探測</span>
              <span className="muted u-text-sm">推薦大多數管理操作</span>
            </button>
            <button
              type="button"
              className={`ssh-purpose-card${purpose === 'user_outbound' ? ' is-on' : ''}`}
              onClick={() => setPurpose('user_outbound')}
            >
              <strong>專案用戶出站</strong>
              <span>git pull、專案腳本 scp</span>
              <span className="muted u-text-sm">寫入專案 home/.ssh</span>
            </button>
          </div>
        ) : null}

        {wizStep === 2 && purpose === 'user_outbound' ? (
          <Field label="專案" htmlFor="wiz-proj" flush fullWidth required>
            <select
              id="wiz-proj"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">— 選擇專案 —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.linuxUser}
                </option>
              ))}
            </select>
            {projects.length === 0 ? (
              <FormHint>尚未有專案 — 請先建立專案與系統用戶</FormHint>
            ) : null}
          </Field>
        ) : null}

        {wizStep === 2 && purpose === 'panel_outbound' ? (
          <div className="ssh-callout">
            <p>
              建立後請把<strong>公鑰</strong>放到目標機的{' '}
              <code className="inline">authorized_keys</code>
              ，再用「測試連線」確認。
            </p>
            <p className="muted u-text-sm u-mb-0">
              私鑰只留在本機控制面；不會出現在列表或日誌。
            </p>
          </div>
        ) : null}

        {wizStep === 3 ? (
          <FormLayout columns={1}>
            <Field label="顯示名稱" htmlFor="wiz-name" flush required hint="例如 peer-prod、myapp-git">
              <input
                id="wiz-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={defaultName()}
                spellCheck={false}
              />
            </Field>
            <Field label="演算法" htmlFor="wiz-algo" flush>
              <SegRadio
                name="wiz-algo"
                aria-label="演算法"
                value={algo}
                onChange={setAlgo}
                options={[
                  { value: 'ed25519', label: 'ed25519', hint: '建議' },
                  { value: 'rsa-4096', label: 'RSA 4096', hint: '舊系統' },
                ]}
              />
            </Field>
            <label className="ssh-check">
              <input
                type="checkbox"
                checked={installNow}
                onChange={(e) => setInstallNow(e.target.checked)}
              />
              <span>
                建立後立即寫入磁碟
                <span className="muted u-text-sm">
                  {' '}
                  （需系統執行權限；否則會提示無法套用）
                </span>
              </span>
            </label>
          </FormLayout>
        ) : null}
      </Modal>

      {/* private reveal */}
      <Modal
        open={Boolean(revealKey)}
        onClose={() => {
          if (!revealAck && revealKey) {
            /* force ack path via footer */
            return;
          }
          setRevealKey(null);
          setRevealFp(null);
          setRevealNextId(null);
        }}
        title="請立即保存私鑰"
        description="關閉後面板不會再顯示私鑰全文。公鑰可隨時複製。"
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                if (revealKey) void navigator.clipboard?.writeText(revealKey);
                onFlash('ok', '已複製私鑰');
              }}
            >
              複製私鑰
            </Button>
            {revealNextId ? (
              <Button
                variant="secondary"
                size="md"
                loading={busy}
                onClick={() => {
                  const id = revealNextId;
                  setRevealKey(null);
                  setRevealAck(false);
                  void runInstall(id);
                }}
              >
                下一步：寫入磁碟
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="md"
              disabled={!revealAck}
              onClick={() => {
                setRevealKey(null);
                setRevealFp(null);
                setRevealNextId(null);
                setRevealAck(false);
              }}
            >
              我已保存，關閉
            </Button>
          </>
        }
      >
        {revealFp ? (
          <FormHint>
            Fingerprint：<code className="inline u-break-all">{revealFp}</code>
          </FormHint>
        ) : null}
        <Field label="Private key（僅此一次）" htmlFor="reveal-priv" flush fullWidth>
          <textarea
            id="reveal-priv"
            rows={8}
            readOnly
            value={revealKey ?? ''}
            className="u-font-mono"
            spellCheck={false}
          />
        </Field>
        <label className="ssh-check u-mt-3">
          <input
            type="checkbox"
            checked={revealAck}
            onChange={(e) => setRevealAck(e.target.checked)}
          />
          <span>我已把私鑰存到安全位置（密碼管理器／離線備份）</span>
        </label>
      </Modal>

      {/* test */}
      <Modal
        open={Boolean(testId)}
        onClose={() => setTestId(null)}
        title="測試連線"
        description="用此身份嘗試 ssh … true。成功只代表這個目標可登入。"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setTestId(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={!testTarget.includes('@')}
              onClick={() => void runTest()}
            >
              開始測試
            </Button>
          </>
        }
      >
        <Field
          label="目標"
          htmlFor="test-target"
          flush
          required
          hint="格式 user@host 或 user@host:port"
        >
          <input
            id="test-target"
            value={testTarget}
            onChange={(e) => setTestTarget(e.target.value)}
            placeholder="root@10.0.0.2"
            spellCheck={false}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => void confirmAction()}
        title={confirm?.kind === 'delete' ? '刪除身份？' : '輪替金鑰？'}
        description={
          confirm?.kind === 'delete'
            ? `將刪除「${confirm?.name}」並嘗試清除磁碟上的私鑰檔。此操作無法復原。`
            : `「${confirm?.name}」會標記為已退役，並產生一把新金鑰。請更新對方 authorized_keys。`
        }
        confirmLabel={confirm?.kind === 'delete' ? '刪除' : '輪替'}
        cancelLabel="取消"
        danger={confirm?.kind === 'delete'}
        busy={busy}
      />
    </div>
  );
}

function StatusPipeline({ status }: { status: string }) {
  const step = pipelineStep(status);
  const labels = ['已入庫', '已寫磁碟', '連線通過'];
  return (
    <ol className="ssh-pipeline" aria-label="進度">
      {labels.map((lab, i) => {
        const done = step !== 3 && i <= step;
        const fail = step === 3 && i === 0;
        return (
          <li
            key={lab}
            className={`ssh-pipeline__step${done ? ' is-done' : ''}${fail ? ' is-fail' : ''}`}
          >
            <span className="ssh-pipeline__dot" />
            <span>{lab}</span>
          </li>
        );
      })}
    </ol>
  );
}
