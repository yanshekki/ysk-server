/**
 * Firewall → Services tab: central view of YSK-managed service exposure.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  FormActions,
  FormHint,
  Modal,
  SegRadio,
  ServerListFilters,
} from '../../shared/components/ui';
import type { BadgeTone } from '../../shared/components/ui';
import { YSK_SERVICE_PORTS } from 'ysk-server-shared';
import { systemApi } from '../../features/system';

type ExposureMode = 'private' | 'public' | 'restricted';

type ExposureItem = {
  serviceId: string;
  desired: {
    serviceId: string;
    mode: ExposureMode;
    ports: Array<{ role: string; port: string; proto?: string }>;
    allowFrom?: string[];
    allowCountries?: string[];
    decided?: boolean;
    updatedAt?: string;
  };
  liveRules?: Array<{ raw?: string; comment?: string }>;
  inSync?: boolean;
  defaultMode?: ExposureMode;
  catalogPorts?: Array<{ role: string; port: string; proto?: string }>;
};

function modeTone(mode: ExposureMode, inSync: boolean): BadgeTone {
  if (!inSync) return 'warn';
  if (mode === 'public') return 'ok';
  if (mode === 'restricted') return 'info';
  return 'neutral';
}

function formatPorts(ports: Array<{ port: string; proto?: string }> | undefined): string {
  if (!ports?.length) return '—';
  return ports
    .map((p) => (p.proto && p.proto !== 'tcp' ? `${p.port}/${p.proto}` : p.port))
    .join(', ');
}

/** Catalog service ids (nginx / postfix / vsftpd / bt-tracker / …). */
export function catalogServiceIds(): string[] {
  return [...new Set(YSK_SERVICE_PORTS.map((p) => p.service))];
}

function catalogPortsFor(sid: string): Array<{ role: string; port: string; proto?: string }> {
  return YSK_SERVICE_PORTS.filter((p) => p.service === sid).map((p) => ({
    role: p.id,
    port: p.port,
    proto: p.proto,
  }));
}

function catalogDefaultMode(sid: string): ExposureMode {
  const ports = YSK_SERVICE_PORTS.filter((p) => p.service === sid);
  if (ports.some((p) => p.privateRecommended)) return 'private';
  return 'public';
}

/** Merge API exposure rows with the managed-port catalog so the tab is never blank. */
export function mergeExposureList(apiItems: ExposureItem[]): ExposureItem[] {
  const byId = new Map(
    apiItems
      .filter((it) => it.serviceId)
      .map((it) => [it.serviceId, it] as const),
  );
  const out: ExposureItem[] = [];
  for (const sid of catalogServiceIds()) {
    const existing = byId.get(sid);
    const ports = catalogPortsFor(sid);
    const mode = catalogDefaultMode(sid);
    if (existing) {
      out.push({
        ...existing,
        catalogPorts: existing.catalogPorts?.length ? existing.catalogPorts : ports,
        defaultMode: existing.defaultMode ?? mode,
      });
      byId.delete(sid);
    } else {
      out.push({
        serviceId: sid,
        desired: {
          serviceId: sid,
          mode,
          ports,
        },
        catalogPorts: ports,
        defaultMode: mode,
        inSync: true,
      });
    }
  }
  for (const rest of byId.values()) out.push(rest);
  return out;
}

export function FirewallServicesPanel(props: {
  canEdit: boolean;
  ufwActive?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusService = searchParams.get('service')?.trim() || '';

  const [items, setItems] = useState<ExposureItem[]>([]);
  const [installedMap, setInstalledMap] = useState<Record<string, boolean>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState(focusService);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<ExposureItem | null>(null);
  const [mode, setMode] = useState<ExposureMode>('private');
  const [allowRaw, setAllowRaw] = useState('');
  const [countriesRaw, setCountriesRaw] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const setBusyBoth = useCallback(
    (b: boolean) => {
      setBusy(b);
      props.onBusy?.(b);
    },
    [props],
  );

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const [r, matrix] = await Promise.all([
        systemApi.serviceExposureList(),
        systemApi.servicesMatrix().catch(() => ({ items: [] as Array<{ id: string; installed?: boolean }> })),
      ]);
      const list = ((r.items ?? []) as ExposureItem[]).map((it) => ({
        ...it,
        serviceId: String(it.serviceId || it.desired?.serviceId || ''),
      }));
      setItems(mergeExposureList(list));
      const map: Record<string, boolean> = {};
      for (const row of matrix.items ?? []) {
        if (row.id) map[row.id] = Boolean(row.installed);
      }
      setInstalledMap(map);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('common.loadFailed'));
      setItems(mergeExposureList([]));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (focusService) setQ(focusService);
  }, [focusService]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => {
      const ports = formatPorts(it.desired?.ports ?? it.catalogPorts);
      return (
        it.serviceId.toLowerCase().includes(needle) ||
        ports.toLowerCase().includes(needle) ||
        (it.desired?.mode ?? '').includes(needle)
      );
    });
  }, [items, q]);

  function openEdit(it: ExposureItem) {
    setEdit(it);
    setMode(it.desired?.mode ?? it.defaultMode ?? 'public');
    setAllowRaw((it.desired?.allowFrom ?? []).join(', '));
    setCountriesRaw((it.desired?.allowCountries ?? []).join(', '));
    setSaveError(null);
    if (it.serviceId) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'services');
      next.set('service', it.serviceId);
      setSearchParams(next, { replace: true });
    }
  }

  async function syncOne(serviceId: string) {
    setBusyBoth(true);
    try {
      await systemApi.serviceExposureSync({
        serviceId,
        reason: 'manual',
        requireDecision: false,
      });
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setBusyBoth(false);
    }
  }

  async function saveEdit() {
    if (!edit) return;
    const allowFrom = allowRaw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const allowCountries = countriesRaw
      .split(/[\s,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{2}$/.test(s));
    if (mode === 'restricted' && allowFrom.length === 0 && allowCountries.length === 0) {
      setSaveError(t('serviceExposure.restrictedNeedSource'));
      return;
    }
    setBusyBoth(true);
    setSaveError(null);
    try {
      await systemApi.serviceExposurePut(edit.serviceId, {
        mode,
        allowFrom: mode === 'restricted' ? allowFrom : [],
        allowCountries: mode === 'restricted' ? allowCountries : [],
        ports: edit.desired?.ports?.length
          ? edit.desired.ports
          : edit.catalogPorts,
        sync: true,
      });
      setEdit(null);
      await refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setBusyBoth(false);
    }
  }

  return (
    <div className="tab-panel def-panel">
      <div className="def-panel-card">
        <div className="def-section-head">
          <h3 className="def-section-head__title">{t('firewall.servicesTitle')}</h3>
          <span className="muted u-text-sm">{t('firewall.servicesHint')}</span>
        </div>
        {props.ufwActive === false ? (
          <Alert variant="warn">{t('firewall.servicesUfwOff')}</Alert>
        ) : null}
        {loadError ? <Alert variant="error">{loadError}</Alert> : null}
        <DataTable
          filters={
            <ServerListFilters
              q={q}
              setQ={setQ}
              searching={false}
              loading={busy}
              total={items.length}
              shown={filtered.length}
              activeFilterCount={q.trim() ? 1 : 0}
              clear={() => setQ('')}
            />
          }
          columns={[
            {
              key: 'service',
              header: t('firewall.colService'),
              nowrap: true,
              render: (r) => (
                <span>
                  <code className="inline">{r.serviceId}</code>
                  {installedMap[r.serviceId] === false ? (
                    <>
                      {' '}
                      <Badge tone="danger">{t('common.notInstalled')}</Badge>
                    </>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'mode',
              header: t('firewall.colMode'),
              nowrap: true,
              render: (r) => {
                if (installedMap[r.serviceId] === false) {
                  return <Badge tone="neutral">{t('common.notInstalled')}</Badge>;
                }
                const m = r.desired?.mode ?? r.defaultMode ?? 'private';
                const label =
                  m === 'private'
                    ? t('serviceExposure.modePrivate')
                    : m === 'restricted'
                      ? t('serviceExposure.modeRestricted')
                      : t('serviceExposure.modePublic');
                if (props.ufwActive === false) {
                  return (
                    <Badge tone="warn">
                      {t('firewall.desiredOnlyUfwOff', { mode: label })}
                    </Badge>
                  );
                }
                return <Badge tone={modeTone(m, r.inSync !== false)}>{label}</Badge>;
              },
            },
            {
              key: 'ports',
              header: t('firewall.colPorts'),
              render: (r) => (
                <code className="inline u-text-sm">
                  {formatPorts(r.desired?.ports?.length ? r.desired.ports : r.catalogPorts)}
                </code>
              ),
            },
            {
              key: 'sync',
              header: t('firewall.colSync'),
              nowrap: true,
              render: (r) =>
                props.ufwActive === false ? (
                  <Badge tone="neutral">{t('firewall.syncNotApplied')}</Badge>
                ) : r.inSync === false ? (
                  <Badge tone="warn">{t('serviceExposure.outOfSync')}</Badge>
                ) : (
                  <Badge tone="ok">{t('firewall.synced')}</Badge>
                ),
            },
          ]}
          rows={filtered}
          rowKey={(r) => r.serviceId}
          rowActions={(r) => (
            <ActionBar align="end">
              {props.canEdit ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() => openEdit(r)}
                  >
                    {t('serviceExposure.manage')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy}
                    onClick={() => void syncOne(r.serviceId)}
                  >
                    {t('firewall.syncNow')}
                  </Button>
                </>
              ) : null}
            </ActionBar>
          )}
          filterActive={Boolean(q.trim())}
          empty={
            <EmptyState
              title={t('firewall.servicesEmpty')}
              description={t('firewall.servicesEmptyDesc')}
            />
          }
        />
        <FormHint>{t('firewall.servicesManualHint')}</FormHint>
      </div>

      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={t('serviceExposure.manageTitle')}
        description={
          edit
            ? t('serviceExposure.manageDesc', { service: edit.serviceId })
            : undefined
        }
        size="md"
        footer={
          <FormActions>
            <Button variant="ghost" size="md" onClick={() => setEdit(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={!props.canEdit}
              onClick={() => void saveEdit()}
            >
              {t('common.save')}
            </Button>
          </FormActions>
        }
      >
        {edit ? (
          <div>
            {saveError ? <Alert variant="error">{saveError}</Alert> : null}
            <p className="form-hint u-mb-3">
              {t('serviceExposure.portsLabel')}:{' '}
              {formatPorts(edit.desired?.ports?.length ? edit.desired.ports : edit.catalogPorts)}
            </p>
            <Field label={t('serviceExposure.mode')} htmlFor="fw-svc-mode" flush>
              <SegRadio
                name="fw-svc-mode"
                aria-label={t('serviceExposure.mode')}
                value={mode}
                onChange={(v) => setMode(v as ExposureMode)}
                options={[
                  { value: 'private', label: t('serviceExposure.modePrivate') },
                  { value: 'public', label: t('serviceExposure.modePublic') },
                  { value: 'restricted', label: t('serviceExposure.modeRestricted') },
                ]}
              />
            </Field>
            {mode === 'public' ? (
              <p className="form-hint service-access-strip__warn">
                {t('serviceExposure.hintPublic')}
              </p>
            ) : null}
            {mode === 'private' ? (
              <FormHint>{t('serviceExposure.hintPrivate')}</FormHint>
            ) : null}
            {mode === 'restricted' ? (
              <div className="u-mt-3 u-stack-form">
                <Field label={t('serviceExposure.allowFrom')} htmlFor="fw-svc-allow" flush>
                  <input
                    id="fw-svc-allow"
                    className="u-input"
                    value={allowRaw}
                    onChange={(e) => setAllowRaw(e.target.value)}
                    placeholder="203.0.113.10, 10.0.0.0/8"
                  />
                  <FormHint>{t('serviceExposure.hintRestricted')}</FormHint>
                </Field>
                <Field label={t('serviceExposure.allowCountries')} htmlFor="fw-svc-cc" flush>
                  <input
                    id="fw-svc-cc"
                    className="u-input"
                    value={countriesRaw}
                    onChange={(e) => setCountriesRaw(e.target.value)}
                    placeholder="HK, CN, US"
                  />
                  <FormHint>{t('serviceExposure.hintCountries')}</FormHint>
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
