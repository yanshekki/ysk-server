/**
 * Redis — service metrics + professional DB picker + equal-height key browser.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { looksLikeBlockedMessage } from '../../shared/lib/operator-messages';
import i18n from '../../shared/lib/i18n';
import { Link } from 'react-router-dom';
import {
  WithPageGuide,
  ActionBar,
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
import { bindSet, bindInput, bindCall1 } from '../bind-handlers';

export function formatTtl(
  ttl: number | undefined,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (ttl == null || ttl === -2) return '—';
  if (ttl === -1) return i18n.t('redis.neverExpire');
  if (ttl < 60) return i18n.t('redis.ttlSeconds', { ttl });
  if (ttl < 3600) return i18n.t('redis.ttlMinutes', { n: Math.floor(ttl / 60) });
  if (ttl < 86400) return i18n.t('redis.ttlHours', { n: Math.floor(ttl / 3600) });
  return i18n.t('redis.ttlDays', { n: Math.floor(ttl / 86400) });
}

export function typeTone(type?: string): 'ok' | 'warn' | 'info' | 'neutral' {
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

export function typeLabel(
  type: string | undefined,
  t: (k: string) => string,
): string {
  const map: Record<string, string> = {
    string: i18n.t('redis.typeString'),
    hash: i18n.t('redis.typeHash'),
    list: i18n.t('redis.typeList'),
    set: i18n.t('redis.typeSet'),
    zset: i18n.t('redis.typeZset'),
  };
  return type ? map[type] ?? type : '—';
}

export function formatValue(view: RedisKeyView): string {
  if (typeof view.value === 'string') return view.value;
  return JSON.stringify(view.value, null, 2);
}

export function keysInDb(svc: RedisServiceStatus | null, db: number): number {
  return svc?.keyspace?.find((k) => k.db === db)?.keys ?? 0;
}

export function clampDbCount(
  configured?: number | null,
  databases?: number | null,
): number {
  return Math.min(
    256,
    Math.max(1, Number(configured ?? databases ?? 16) || 16),
  );
}

export function totalKeysInKeyspace(
  keyspace?: Array<{ keys: number }> | null,
): number {
  return (keyspace ?? []).reduce((s, k) => s + k.keys, 0);
}

export function busyKeyspaces(
  keyspace: Array<{ db: number; keys: number }> | null | undefined,
  dbCount: number,
): Array<{ db: number; keys: number }> {
  return (keyspace ?? [])
    .filter((k) => k.keys > 0 && k.db < dbCount)
    .sort((a, b) => a.db - b.db);
}

export function parseOptionalTtl(s: string): number | undefined {
  return s ? Number(s) : undefined;
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
      setLoadError(e instanceof Error ? e.message : t('common.statusLoadFailed'));
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
      setLoadError(e instanceof Error ? e.message : t('redis.keysLoadFailed'));
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
        const m = e instanceof Error ? e.message : t('common.installFailed');
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, t('redis.installedOk'));
  }

  async function onStart() {
    await run(async () => {
      try {
        const r = await redisApi.start();
        await refreshSvc();
        return r as unknown as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.startFailed');
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, t('redis.startedOk'));
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
          ttl: parseOptionalTtl(newTtl),
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
        const m = err instanceof Error ? err.message : t('redis.writeFailed');
        return { ok: false, blocked: looksLikeBlockedMessage(m), blockMessage: m, notes: [m] };
      }
    }, t('common.savedOk'));
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
        const m = err instanceof Error ? err.message : t('common.deleteFailed');
        return { ok: false, blocked: looksLikeBlockedMessage(m), blockMessage: m, notes: [m] };
      }
    }, t('redis.deleted'));
  }

  const online = Boolean(svc?.canRead);
  const dbCount = clampDbCount(svc?.configuredDatabases, svc?.databases);
  const totalKeys = useMemo(
    () => totalKeysInKeyspace(svc?.keyspace),
    [svc?.keyspace],
  );
  const busyDbs = useMemo(
    () => busyKeyspaces(svc?.keyspace, dbCount),
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
        label: t('common.status'),
        value: online ? t('common.running') : t('redis.offline'),
        tone: online ? ('ok' as const) : ('danger' as const),
      },
      { label: t('common.version'), value: svc.version ?? '—' },
      { label: t('common.memory'), value: svc.usedMemory ?? '—' },
      { label: t('redis.connections'), value: svc.connectedClients ?? '—' },
      { label: t('redis.totalKeys'), value: totalKeys },
      {
        label: t('redis.writable'),
        value: online ? t('common.available') : t('network.unavailable'),
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
          label: online ? t('redis.connected') : t('redis.notConnected'),
          tone: online ? 'ok' : 'warn',
        },
        items: summaryItems.length
          ? summaryItems.slice(0, 4).map((s) => ({
              label: s.label,
              value: s.value,
            }))
          : [
              { label: t('common.status'), value: online ? 'online' : 'offline' },
              { label: 'DB', value: db },
              { label: t('redis.keys'), value: keys.length },
              { label: t('redis.selected'), value: selectedKey ? '1' : '0' },
            ],
      }}
      actions={<ActionBar>
          <Link to="/databases/redis/service">
            <Button variant="secondary" size="sm">
              {t('db.serviceSettings')}
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
            {t('common.refresh')}
          </Button>
          {online ? (
            <Button variant="primary" size="sm" onClick={bindSet(setSetOpen, true)}>
              {t('redis.addKey')}
            </Button>
          ) : null}
        </ActionBar>
      }
    >
      <WithPageGuide guideId="redis">

      <SoftwareInstallBanner
        feature="redis"
        title={t('redis.softwareMissing')}
        onInstalled={() => void refreshSvc()}
      />
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={bindSet(setMsg, null)}>
            {t('common.close')}
          </Button>
        </Alert>
      ) : null}

      {!online ? (
        <EmptyState
          title={t('redis.notConnectedTitle')}
          description={
            !svc?.serverInstalled
              ? t('redis.installThenStart')
              : t('redis.installedNotConnected')
          }
        />
      ) : (
        <>
          {/* DB picker — select is primary; pills only for DBs with data */}
          <div className="redis-db-picker">
            <div className="redis-db-picker__row">
              <div className="redis-db-picker__select">
                <label htmlFor="redis-db-select">{t('common.database')}</label>
                <select
                  id="redis-db-select"
                  value={db}
                  onChange={(e) => selectDb(Number(e.target.value))}
                >
                  {Array.from({ length: dbCount }, (_, i) => {
                    const n = keysInDb(svc, i);
                    return (
                      <option key={i} value={i}>
                        {t('redis.dbLabel', { i })}
                        {n > 0 ? t('redis.keysInDb', { n }) : ''}
                      </option>
                    );
                  })}
                </select>
                <p className="muted u-text-sm u-mt-2">
                  {t('redis.dbRange', { n: dbCount, max: dbCount - 1 })}
                  <Link to="/databases/redis/service">{t('redis.serviceLink')}</Link>
                </p>
              </div>
              {busyDbs.length > 0 ? (
                <div className="redis-db-picker__quick">
                  <span className="redis-db-picker__quick-label">{t('redis.dbsWithData')}</span>
                  <div className="redis-db-picker__pills">
                    {busyDbs.map((k) => (
                      <button
                        key={k.db}
                        type="button"
                        className={`redis-db-pill${db === k.db ? ' is-active' : ''}`}
                        onClick={bindCall1(selectDb, k.db)}
                      >
                        DB {k.db}
                        <span className="redis-db-pill__meta">{t('redis.keysShort', { k: k.keys })}</span>
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
              onChange={bindInput(setPatternDraft)}
              placeholder={t('redis.searchPlaceholder')}
              aria-label={t('redis.searchKeys')}
            />
            <Button type="submit" variant="secondary" size="md" loading={loadingKeys}>
              {t('common.search')}
            </Button>
          </form>

          <SplitPanel
            minHeight="26rem"
            ratio="1fr 1.15fr"
            leftTitle={
              <>
                {t('redis.keyList')}
                <span className="muted u-text-sm u-font-medium">
                  {loadingKeys ? t('runtime.loading') : t('redis.rows', { n: keys.length })}
                </span>
              </>
            }
            rightTitle={t('redis.content')}
            rightActions={
              selected ? (
                <Button variant="danger" size="sm" disabled={busy} onClick={bindSet(setDelKey, selected.key)}>
                  {t('common.delete')}
                </Button>
              ) : null
            }
            left={
              loadingKeys ? (
                <p className="muted u-pad-panel">
                  {t('common.loading')}
                </p>
              ) : keys.length === 0 ? (
                <div className="u-pad-panel u-flex-1">
                  <EmptyState
                    title={t('redis.noMatchingKeys')}
                    description={
                      pattern === '*'
                        ? t('redis.dbEmpty', { db })
                        : t('redis.noMatchPattern', { pattern })
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
                        onClick={bindCall1(openKey, k.key)}
                      >
                        <span className="redis-key-row__name">{k.key}</span>
                        <span className="redis-key-row__meta">
                          <Badge tone={typeTone(k.type)}>{typeLabel(k.type, t)}</Badge>
                          <span className="muted u-text-sm">{formatTtl(k.ttl, t)}</span>
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
                  <p className="muted">{t('redis.pickKey')}</p>
                </div>
              ) : (
                <div className="redis-detail-body">
                  <div className="redis-detail-meta">
                    <div className="redis-detail-key">{selected.key}</div>
                    <ActionBar>
                      <Badge tone={typeTone(selected.type)}>{typeLabel(selected.type, t)}</Badge>
                      <span className="muted u-text-sm">{t('redis.ttlPrefix', { ttl: formatTtl(selected.ttl, t) })}</span>
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
          <OpsResultPanel title={t('systemd.opsResult')} result={result} message={null} busy={busy} />
        </div>
      ) : null}

      <Modal
        open={setOpen}
        onClose={bindSet(setSetOpen, false)}
        title={t('redis.addStringKey')}
        description={t('redis.writeToDb', { db })}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setSetOpen, false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="redis-set" variant="primary" size="md" loading={busy}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form id="redis-set" onSubmit={(e) => void onSetKey(e)}>
          <FormLayout columns={2}>
            <Field
              label={t('redis.keyName')}
              htmlFor="nk"
              flush
              required
              hint={t('redis.keyNameHint')}
            >
              <input
                id="nk"
                value={newKey}
                onChange={bindInput(setNewKey)}
                required
                placeholder="session:user:1"
                pattern="[\w.:@/+\-\[\]{}|=,~-]+"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field
              label={t('redis.ttlLabel')}
              htmlFor="nt"
              flush
              hint={t('redis.ttlHint')}
            >
              <PresetChips
                options={[
                  { value: '', label: t('redis.neverExpire') },
                  { value: '60', label: t('redis.m1') },
                  { value: '300', label: t('redis.m5') },
                  { value: '3600', label: t('runtime.h1') },
                  { value: '86400', label: t('runtime.d1') },
                  { value: '604800', label: t('runtime.d7') },
                ]}
                value={newTtl}
                onChange={setNewTtl}
                allowCustom
                customPlaceholder={t('redis.customSeconds')}
              />
            </Field>
            <Field label={t('redis.content')} htmlFor="nv" fullWidth flush required hint={t('redis.stringValue')}>
              <textarea
                id="nv"
                value={newVal}
                onChange={bindInput(setNewVal)}
                rows={6}
                required
                placeholder={t('redis.stringContent')}
                spellCheck={false}
              />
            </Field>
          </FormLayout>
          <FormHint>{t('redis.writeLiveHint')}</FormHint>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(delKey)}
        onClose={bindSet(setDelKey, null)}
        onConfirm={onDeleteKey}
        title={t('redis.deleteKeyTitle')}
        description={t('redis.deleteKeyDesc', { db, key: delKey })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
      />
    
      </WithPageGuide>
    </FeaturePageLayout>
  );
}
