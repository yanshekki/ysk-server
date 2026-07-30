/**
 * Redis — service metrics + professional DB picker + equal-height key browser.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ActionBar,
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormHint,
  FormLayout,
  Modal,
  OpsResultPanel,
  PresetChips,
  SoftwareInstallBanner,
  SplitPanel,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import {
  redisApi,
  type RedisKeyListItem,
  type RedisKeyView,
  type RedisServiceStatus,
} from '../../features/redis';
import { useFeatureAction } from '../../features/system/useFeatureAction';

function formatTtl(ttl?: number): string {
  if (ttl == null || ttl === -2) return '—';
  if (ttl === -1) return '永不過期';
  if (ttl < 60) return `${ttl} 秒`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)} 分鐘`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)} 小時`;
  return `${Math.floor(ttl / 86400)} 天`;
}

function typeTone(type?: string): 'ok' | 'warn' | 'info' | 'neutral' {
  switch (type) {
    case 'string':
      return 'ok';
    case 'hash':
      return 'info';
    case 'list':
      return 'warn';
    default:
      return 'neutral';
  }
}

function typeLabel(type?: string): string {
  const map: Record<string, string> = {
    string: '字串',
    hash: '雜湊',
    list: '列表',
    set: '集合',
    zset: '有序集合',
  };
  return type ? map[type] ?? type : '—';
}

function formatValue(view: RedisKeyView): string {
  if (typeof view.value === 'string') return view.value;
  return JSON.stringify(view.value, null, 2);
}

function keysInDb(svc: RedisServiceStatus | null, db: number): number {
  return svc?.keyspace?.find((k) => k.db === db)?.keys ?? 0;
}

export function RedisPage() {
  const { t } = useTranslation();
  const [svc, setSvc] = useState<RedisServiceStatus | null>(null);
  const [db, setDb] = useState(0);
  const [pattern, setPattern] = useState('*');
  const [patternDraft, setPatternDraft] = useState('*');
  const [keys, setKeys] = useState<RedisKeyListItem[]>([]);
  const [selected, setSelected] = useState<RedisKeyView | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setOpen, setSetOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [newTtl, setNewTtl] = useState('');
  const [delKey, setDelKey] = useState<string | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refreshSvc = useCallback(async () => {
    setLoadError(null);
    try {
      setSvc(await redisApi.status());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '狀態載入失敗');
    }
  }, []);

  const loadKeys = useCallback(async () => {
    setLoadingKeys(true);
    setLoadError(null);
    try {
      const r = await redisApi.keys({ db, pattern, count: 200 });
      setKeys(r.keys ?? []);
    } catch (e) {
      setKeys([]);
      setLoadError(e instanceof Error ? e.message : '無法載入鍵列表');
    } finally {
      setLoadingKeys(false);
    }
  }, [db, pattern]);

  useEffect(() => {
    void refreshSvc();
  }, [refreshSvc]);

  useEffect(() => {
    if (svc?.canRead) void loadKeys();
    else setKeys([]);
  }, [svc?.canRead, loadKeys]);

  async function onInstall() {
    await run(async () => {
      try {
        const r = await redisApi.install();
        await refreshSvc();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : '安裝失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, 'Redis 已安裝');
  }

  async function onStart() {
    await run(async () => {
      try {
        const r = await redisApi.start();
        await refreshSvc();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : '啟動失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, 'Redis 已啟動');
  }

  async function openKey(key: string) {
    setSelectedKey(key);
    try {
      const r = await redisApi.getKey(db, key);
      setSelected(r.view ?? null);
    } catch {
      setSelected(null);
    }
  }

  async function onSetKey(e: FormEvent) {
    e.preventDefault();
    const keyToOpen = newKey;
    await run(async () => {
      try {
        const r = await redisApi.setKey({
          db,
          key: keyToOpen,
          value: newVal,
          ttl: newTtl ? Number(newTtl) : undefined,
        });
        setSetOpen(false);
        setNewKey('');
        setNewVal('');
        setNewTtl('');
        await refreshSvc();
        await loadKeys();
        void openKey(keyToOpen);
        return r as unknown as OpsResultLike;
      } catch (err) {
        const m = err instanceof Error ? err.message : '寫入失敗';
        return { ok: false, blocked: /權限|系統變更/.test(m), blockMessage: m, notes: [m] };
      }
    }, '已儲存');
  }

  async function onDeleteKey() {
    if (!delKey) return;
    await run(async () => {
      try {
        const r = await redisApi.delKey({ db, key: delKey });
        setDelKey(null);
        if (selectedKey === delKey) {
          setSelected(null);
          setSelectedKey(null);
        }
        await refreshSvc();
        await loadKeys();
        return r as unknown as OpsResultLike;
      } catch (err) {
        const m = err instanceof Error ? err.message : '刪除失敗';
        return { ok: false, blocked: /權限|系統變更/.test(m), blockMessage: m, notes: [m] };
      }
    }, '已刪除');
  }

  const online = Boolean(svc?.canRead);
  const dbCount = Math.min(
    256,
    Math.max(1, Number(svc?.configuredDatabases ?? svc?.databases ?? 16) || 16),
  );
  const totalKeys = useMemo(
    () => (svc?.keyspace ?? []).reduce((s, k) => s + k.keys, 0),
    [svc?.keyspace],
  );
  const busyDbs = useMemo(
    () =>
      (svc?.keyspace ?? [])
        .filter((k) => k.keys > 0 && k.db < dbCount)
        .sort((a, b) => a.db - b.db),
    [svc?.keyspace, dbCount],
  );

  // Clamp selected db if databases shrunk
  useEffect(() => {
    if (db >= dbCount) {
      setDb(0);
      setSelected(null);
      setSelectedKey(null);
    }
  }, [db, dbCount]);

  const summaryItems = useMemo(() => {
    if (!svc) return [];
    return [
      {
        label: '狀態',
        value: online ? '運行中' : '離線',
        tone: online ? ('ok' as const) : ('danger' as const),
      },
      { label: '版本', value: svc.version ?? '—' },
      { label: '記憶體', value: svc.usedMemory ?? '—' },
      { label: '連線數', value: svc.connectedClients ?? '—' },
      { label: '總鍵數', value: totalKeys },
      {
        label: '寫入',
        value: online ? '可用' : '不可用',
        tone: online ? ('ok' as const) : ('warn' as const),
      },
    ];
  }, [svc, online, totalKeys]);

  function selectDb(n: number) {
    setDb(n);
    setSelected(null);
    setSelectedKey(null);
  }

  return (
    <FeaturePageLayout
      title={t('nav.redis', { defaultValue: 'Redis' })}
      status={{
        pill: {
          label: online ? '已連線' : '未連線',
          tone: online ? 'ok' : 'warn',
        },
        items: summaryItems.length
          ? summaryItems.slice(0, 4).map((s) => ({
              label: s.label,
              value: s.value,
            }))
          : [
              { label: '狀態', value: online ? 'online' : 'offline' },
              { label: 'DB', value: db },
              { label: '鍵', value: keys.length },
              { label: '選中', value: selectedKey ? '1' : '0' },
            ],
      }}
      actions={<ActionBar>
          <Link to="/databases/redis/service">
            <Button variant="secondary" size="sm">
              服務設定
            </Button>
          </Link>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || loadingKeys}
            onClick={() => {
              setError(null);
              setMsg(null);
              void refreshSvc();
              if (online) void loadKeys();
            }}
          >
            重新整理
          </Button>
          {online ? (
            <Button variant="primary" size="sm" onClick={() => setSetOpen(true)}>
              新增鍵
            </Button>
          ) : null}
        </ActionBar>
      }
    >
      <SoftwareInstallBanner
        feature="redis"
        title="Redis 所需軟件尚未安裝"
        onInstalled={() => void refreshSvc()}
      />
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

      {!online ? (
        <EmptyState
          title="尚未連上 Redis"
          description={
            !svc?.serverInstalled
              ? '請先使用上方橫幅一鍵安裝 Redis，再啟動服務。'
              : '服務已安裝但未連上，請啟動服務後即可瀏覽鍵與內容。'
          }
          action={
            svc?.serverInstalled ? (
              <Button
                variant="primary"
                size="lg"
                loading={busy}
                onClick={() => void onStart()}
              >
                啟動服務
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* DB picker — select is primary; pills only for DBs with data */}
          <div className="redis-db-picker">
            <div className="redis-db-picker__row">
              <div className="redis-db-picker__select">
                <label htmlFor="redis-db-select">資料庫</label>
                <select
                  id="redis-db-select"
                  value={db}
                  onChange={(e) => selectDb(Number(e.target.value))}
                >
                  {Array.from({ length: dbCount }, (_, i) => {
                    const n = keysInDb(svc, i);
                    return (
                      <option key={i} value={i}>
                        資料庫 {i}
                        {n > 0 ? ` · ${n} 個鍵` : ''}
                      </option>
                    );
                  })}
                </select>
                <p className="muted u-text-sm u-mt-2" style={{ marginBottom: 0 }}>
                  共 {dbCount} 個庫（0–{dbCount - 1}）。
                  <Link to="/databases/redis/service">在服務設定加減數量</Link>
                </p>
              </div>
              {busyDbs.length > 0 ? (
                <div className="redis-db-picker__quick">
                  <span className="redis-db-picker__quick-label">有資料的庫（快捷）</span>
                  <div className="redis-db-picker__pills">
                    {busyDbs.map((k) => (
                      <button
                        key={k.db}
                        type="button"
                        className={`redis-db-pill${db === k.db ? ' is-active' : ''}`}
                        onClick={() => selectDb(k.db)}
                      >
                        DB {k.db}
                        <span className="redis-db-pill__meta">{k.keys} 鍵</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <form
            className="redis-search-bar"
            onSubmit={(e) => {
              e.preventDefault();
              setPattern(patternDraft.trim() || '*');
            }}
          >
            <input
              value={patternDraft}
              onChange={(e) => setPatternDraft(e.target.value)}
              placeholder="搜尋鍵名，例如 user:* 或 *"
              aria-label="搜尋鍵"
            />
            <Button type="submit" variant="secondary" size="md" loading={loadingKeys}>
              搜尋
            </Button>
          </form>

          <SplitPanel
            minHeight="26rem"
            ratio="1fr 1.15fr"
            leftTitle={
              <>
                鍵列表
                <span className="muted u-text-sm" style={{ fontWeight: 500 }}>
                  {loadingKeys ? '載入中' : `${keys.length} 筆`}
                </span>
              </>
            }
            rightTitle="內容"
            rightActions={
              selected ? (
                <Button variant="danger" size="sm" disabled={busy} onClick={() => setDelKey(selected.key)}>
                  刪除
                </Button>
              ) : null
            }
            left={
              loadingKeys ? (
                <p className="muted" style={{ padding: '1.25rem' }}>
                  載入中…
                </p>
              ) : keys.length === 0 ? (
                <div style={{ padding: '1.25rem', flex: 1 }}>
                  <EmptyState
                    title="沒有符合的鍵"
                    description={
                      pattern === '*'
                        ? `資料庫 ${db} 目前是空的。`
                        : `沒有符合「${pattern}」的鍵。`
                    }
                    action={
                      <Button variant="primary" size="md" onClick={() => setSetOpen(true)}>
                        新增鍵
                      </Button>
                    }
                  />
                </div>
              ) : (
                <ul className="redis-key-list">
                  {keys.map((k) => (
                    <li key={k.key}>
                      <button
                        type="button"
                        className={`redis-key-row${selectedKey === k.key ? ' is-active' : ''}`}
                        onClick={() => void openKey(k.key)}
                      >
                        <span className="redis-key-row__name">{k.key}</span>
                        <span className="redis-key-row__meta">
                          <Badge tone={typeTone(k.type)}>{typeLabel(k.type)}</Badge>
                          <span className="muted u-text-sm">{formatTtl(k.ttl)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            }
            right={
              !selected ? (
                <div className="redis-detail-empty">
                  <p className="muted">從左側選擇一個鍵，即可查看內容。</p>
                </div>
              ) : (
                <div className="redis-detail-body">
                  <div className="redis-detail-meta">
                    <div className="redis-detail-key">{selected.key}</div>
                    <ActionBar>
                      <Badge tone={typeTone(selected.type)}>{typeLabel(selected.type)}</Badge>
                      <span className="muted u-text-sm">過期：{formatTtl(selected.ttl)}</span>
                    </ActionBar>
                  </div>
                  <div className="redis-detail-value">
                    <pre>{formatValue(selected)}</pre>
                  </div>
                </div>
              )
            }
          />
        </>
      )}

      {result ? (
        <div className="u-mt-4">
          <OpsResultPanel title="操作結果" result={result} message={null} busy={busy} />
        </div>
      ) : null}

      <Modal
        open={setOpen}
        onClose={() => setSetOpen(false)}
        title="新增字串鍵"
        description={`寫入 Redis 資料庫 ${db}（即時生效，請謹慎）`}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setSetOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="redis-set" variant="primary" size="md" loading={busy}>
              儲存
            </Button>
          </>
        }
      >
        <form id="redis-set" onSubmit={(e) => void onSetKey(e)}>
          <FormLayout columns={2}>
            <Field
              label="鍵名"
              htmlFor="nk"
              flush
              required
              hint="建議用冒號分層，例如 session:user:1"
            >
              <input
                id="nk"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                required
                placeholder="session:user:1"
                pattern="[\w.:@/+\-\[\]{}|=,~-]+"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field
              label="過期時間（秒）"
              htmlFor="nt"
              flush
              hint="可留空表示永不過期"
            >
              <PresetChips
                options={[
                  { value: '', label: '永不過期' },
                  { value: '60', label: '1 分' },
                  { value: '300', label: '5 分' },
                  { value: '3600', label: '1 時' },
                  { value: '86400', label: '1 日' },
                  { value: '604800', label: '7 日' },
                ]}
                value={newTtl}
                onChange={setNewTtl}
                allowCustom
                customPlaceholder="自訂秒數"
              />
            </Field>
            <Field label="內容" htmlFor="nv" fullWidth flush required hint="字串值，會以 SET 寫入">
              <textarea
                id="nv"
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
                rows={6}
                required
                placeholder="字串內容"
                spellCheck={false}
              />
            </Field>
          </FormLayout>
          <FormHint>此操作直接寫入執行中的 Redis，無法從面板一鍵還原。</FormHint>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(delKey)}
        onClose={() => setDelKey(null)}
        onConfirm={() => void onDeleteKey()}
        title="刪除此鍵？"
        description={`確定從資料庫 ${db} 刪除「${delKey}」？此操作無法復原。`}
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
