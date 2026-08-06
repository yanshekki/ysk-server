/**
 * Companion tools for runtimes (pm2, poetry, maven, …).
 * Install: multi-select only items not yet on host.
 * Uninstall: separate list of installed tools with confirm.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  FormActions,
  FormHint,
  InstallStreamPanel,
  MultiCheckSelect,
  OpsResultPanel,
} from '../../shared/components/ui';
import type { InstallStreamLine, MultiCheckOption, OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../system';
import { toast } from '../../shared/stores/toast-store';

export type RuntimePluginRow = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  recommended: boolean;
  required: boolean;
  installed?: boolean;
};

export function RuntimePluginsField({
  kind,
  value,
  onChange,
  disabled,
  /** Bump after parent runtime install so catalog re-probes */
  refreshToken = 0,
  /** Hide standalone install when parent shows one runtime install CTA */
  showInstallButton = true,
}: {
  kind: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  refreshToken?: number;
  showInstallButton?: boolean;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RuntimePluginRow[]>([]);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyUninstall, setBusyUninstall] = useState(false);
  const [busyInstall, setBusyInstall] = useState(false);
  const [installLog, setInstallLog] = useState<InstallStreamLine[]>([]);
  const [confirmUninstall, setConfirmUninstall] = useState<RuntimePluginRow | null>(null);
  const [batchUninstall, setBatchUninstall] = useState(false);
  const [uninstallSelected, setUninstallSelected] = useState<string[]>([]);
  const [opsResult, setOpsResult] = useState<OpsResultLike | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const load = useCallback(
    async (opts?: { bust?: boolean; optimisticInstalled?: string[] }) => {
      if (kind === 'php') {
        setRows([]);
        setDefaults([]);
        setLoaded(true);
        return;
      }
      try {
        let items: Array<{
          id: string;
          label: string;
          hint?: string;
          group?: string;
          recommended: boolean;
          required: boolean;
          installed?: boolean;
        }> = [];
        let defs: string[] = [];
        const bust = Boolean(opts?.bust);
        try {
          const r = await systemApi.runtimeAddons(kind, undefined, { bust });
          items = r.items ?? [];
          defs = r.defaults ?? [];
        } catch {
          const r = await systemApi.runtimePlugins(kind, { bust });
          items = (r.plugins ?? []).map((p) => ({
            id: p.id,
            label: p.label,
            hint: p.hint,
            group: p.group,
            recommended: Boolean(p.recommended),
            required: Boolean(p.required),
            installed: Boolean(p.installed),
          }));
          defs = r.defaults ?? [];
        }
        const optSet = new Set(opts?.optimisticInstalled ?? []);
        const mapped: RuntimePluginRow[] = items.map((p) => ({
          id: p.id,
          label: p.label,
          hint: p.hint,
          group: p.group,
          recommended: Boolean(p.recommended),
          required: Boolean(p.required),
          installed: Boolean(p.installed) || optSet.has(p.id),
        }));
        setRows(mapped);
        setDefaults(defs);
        setLoaded(true);
        // Drop already-installed from selection (latest value via ref)
        const installedIds = new Set(mapped.filter((r) => r.installed).map((r) => r.id));
        const cur = Array.isArray(valueRef.current) ? valueRef.current : [];
        const stripped = cur.filter((id) => !installedIds.has(id));
        if (stripped.length !== cur.length) onChangeRef.current(stripped);
      } catch {
        setRows([]);
        setDefaults([]);
        setLoaded(true);
      }
    },
    [kind],
  );

  useEffect(() => {
    void load({ bust: refreshToken > 0 });
  }, [load, refreshToken]);

  // Seed recommended defaults once (API already excludes installed)
  useEffect(() => {
    if (!loaded || !defaults.length) return;
    if (value.length === 0) onChange([...defaults]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot seed per kind
  }, [loaded, kind]);

  const available = useMemo(
    () => rows.filter((r) => !r.required && !r.installed),
    [rows],
  );
  const installed = useMemo(
    () => rows.filter((r) => r.installed && !r.required),
    [rows],
  );
  const requiredRows = useMemo(() => rows.filter((r) => r.required), [rows]);

  const options: MultiCheckOption[] = useMemo(
    () =>
      available.map((r) => ({
        value: r.id,
        label: r.label,
        hint: r.hint ?? r.id,
      })),
    [available],
  );

  const selectableIds = useMemo(() => available.map((r) => r.id), [available]);
  const recommendedAvailable = useMemo(
    () => defaults.filter((id) => selectableIds.includes(id)),
    [defaults, selectableIds],
  );

  const selectedForInstall = useMemo(
    () => value.filter((id) => selectableIds.includes(id)),
    [value, selectableIds],
  );

  const kindArg = kind as
    | 'node'
    | 'python'
    | 'go'
    | 'rust'
    | 'java'
    | 'kotlin'
    | 'bun';

  const presentOps = useCallback(
    (
      r: { ok?: boolean; notes?: string[]; blocked?: boolean; blockMessage?: string },
      okToast: string,
      failToast: string,
    ) => {
      setOpsResult({
        ok: r.ok !== false && !r.blocked,
        notes: r.notes,
        blocked: r.blocked,
        blockMessage: r.blockMessage,
      });
      if (r.blocked) {
        toast.warn(r.blockMessage ?? r.notes?.[0] ?? t('runtime.pluginUninstallBlocked'));
      } else if (r.ok === false) {
        toast.error(r.notes?.[0] ?? failToast);
      } else {
        toast.ok(okToast);
      }
    },
    [t],
  );

  const doInstallSelected = useCallback(async () => {
    if (!selectedForInstall.length || !showInstallButton) return;
    const installedNow = [...selectedForInstall];
    setBusyInstall(true);
    setInstallLog([]);
    try {
      const r = (await systemApi.runtimePluginsInstallStream(
        {
          kind: kindArg,
          plugins: installedNow,
        },
        {
          onLog: (line) => setInstallLog((prev) => [...prev.slice(-1999), line]),
        },
      )) as { ok?: boolean; notes?: string[]; blocked?: boolean; blockMessage?: string };
      presentOps(
        r,
        t('runtime.pluginInstallOk', { n: installedNow.length }),
        t('runtime.pluginInstallFailed'),
      );
      if (r.ok !== false && !r.blocked) {
        // Optimistic: move to「已安裝」immediately, then re-probe host
        setRows((prev) =>
          prev.map((row) =>
            installedNow.includes(row.id) ? { ...row, installed: true } : row,
          ),
        );
        onChange(requiredRows.map((x) => x.id));
        await load({ bust: true, optimisticInstalled: installedNow });
      } else {
        await load({ bust: true });
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : t('runtime.pluginInstallFailed');
      toast.error(m);
      setOpsResult({ ok: false, notes: [m] });
      await load({ bust: true });
    } finally {
      setBusyInstall(false);
    }
  }, [
    kindArg,
    load,
    onChange,
    presentOps,
    requiredRows,
    selectedForInstall,
    showInstallButton,
    t,
  ]);

  const runUninstallIds = useCallback(
    async (ids: string[], label: string) => {
      setBusyUninstall(true);
      try {
        const r = (await systemApi.runtimePluginsUninstall({
          kind: kindArg,
          plugins: ids,
        })) as { ok?: boolean; notes?: string[]; blocked?: boolean; blockMessage?: string };
        presentOps(
          r,
          ids.length === 1
            ? t('runtime.pluginUninstalled', { name: label })
            : t('runtime.pluginBatchUninstalled', { n: ids.length, defaultValue: `已卸載 ${ids.length} 個工具` }),
          t('runtime.pluginUninstallFailed', { name: label }),
        );
        setUninstallSelected([]);
        if (r.ok !== false && !r.blocked) {
          setRows((prev) =>
            prev.map((row) => (ids.includes(row.id) ? { ...row, installed: false } : row)),
          );
        }
        await load({ bust: true });
      } catch (e) {
        const m = e instanceof Error ? e.message : t('runtime.pluginUninstallFailed', { name: label });
        toast.error(m);
        setOpsResult({ ok: false, notes: [m] });
        await load({ bust: true });
      } finally {
        setBusyUninstall(false);
        setConfirmUninstall(null);
        setBatchUninstall(false);
      }
    },
    [kindArg, load, presentOps, t],
  );

  const doUninstall = useCallback(
    async (plugin: RuntimePluginRow) => {
      await runUninstallIds([plugin.id], plugin.label);
    },
    [runUninstallIds],
  );

  if (kind === 'php' || (loaded && rows.length === 0)) return null;

  return (
    <div className="u-mt-3 runtime-plugins">
      {installed.length > 0 ? (
        <div className="runtime-plugins__installed u-mb-3">
          <Field
            label={t('runtime.pluginsInstalledTitle')}
            htmlFor={`rt-plugins-installed-${kind}`}
            flush
            hint={t('runtime.pluginsInstalledHint')}
          >
            <ul className="runtime-plugins__list" id={`rt-plugins-installed-${kind}`}>
              {installed.map((p) => {
                const checked = uninstallSelected.includes(p.id);
                return (
                  <li key={p.id} className="runtime-plugins__row">
                    <label className="runtime-plugins__meta u-flex u-items-center u-gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled || busyUninstall}
                        onChange={() => {
                          setUninstallSelected((prev) =>
                            checked ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                          );
                        }}
                      />
                      <span className="runtime-plugins__name">{p.label}</span>
                      <Badge tone="ok">{t('runtime.pluginStatusInstalled')}</Badge>
                      {p.hint ? (
                        <code className="runtime-plugins__hint muted u-text-sm">{p.hint}</code>
                      ) : null}
                    </label>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={disabled || busyUninstall}
                      loading={busyUninstall && confirmUninstall?.id === p.id}
                      onClick={() => setConfirmUninstall(p)}
                    >
                      {t('runtime.pluginUninstall')}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {uninstallSelected.length > 0 ? (
              <FormActions>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={disabled || busyUninstall}
                  loading={busyUninstall && batchUninstall}
                  onClick={() => setBatchUninstall(true)}
                >
                  {t('runtime.pluginBatchUninstall', {
                    n: uninstallSelected.length,
                    defaultValue: `卸載選定 (${uninstallSelected.length})`,
                  })}
                </Button>
              </FormActions>
            ) : null}
          </Field>
        </div>
      ) : null}

      {opsResult ? (
        <div className="u-mt-2 u-mb-2" id={`rt-plugins-ops-${kind}`}>
          <OpsResultPanel
            title={t('runtime.pluginsOpsTitle', { defaultValue: '工具操作結果' })}
            result={opsResult}
          />
        </div>
      ) : null}

      {available.length > 0 ? (
        <>
          <Field
            label={t('runtime.pluginsAvailableTitle')}
            htmlFor={`rt-plugins-${kind}`}
            flush
            hint={t('runtime.pluginsSelectHint')}
          >
            <MultiCheckSelect
              id={`rt-plugins-${kind}`}
              options={options}
              value={selectedForInstall}
              onChange={(next) => {
                const required = requiredRows.map((r) => r.id);
                onChange([...new Set([...required, ...next])]);
              }}
              searchPlaceholder={t('runtime.pluginsSearch')}
              emptyText={t('runtime.pluginsEmpty')}
              maxVisible={200}
              showSelectAll
              listSize="lg"
              listMaxHeight="22rem"
              disabled={disabled || busyUninstall}
            />
          </Field>
          <FormActions>
            {showInstallButton ? (
              <Button
                variant="primary"
                size="md"
                disabled={
                  disabled || busyUninstall || busyInstall || !selectedForInstall.length
                }
                loading={busyInstall}
                onClick={() => void doInstallSelected()}
              >
                {t('runtime.pluginsInstallSelected', {
                  n: selectedForInstall.length,
                  defaultValue: `安裝選定工具 (${selectedForInstall.length})`,
                })}
              </Button>
            ) : (
              <FormHint>
                {t('runtime.pluginsBundleWithRuntime', {
                  defaultValue: '選定工具會隨下方「安裝 runtime」一併安裝（只有一個安裝按鈕）。',
                })}
              </FormHint>
            )}
            <Button
              variant="secondary"
              size="md"
              disabled={disabled || busyUninstall || busyInstall || !recommendedAvailable.length}
              onClick={() => onChange([...recommendedAvailable])}
            >
              {t('runtime.pluginsRecommended')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              disabled={disabled || busyUninstall || busyInstall || !selectableIds.length}
              onClick={() => {
                const required = requiredRows.map((r) => r.id);
                onChange([...new Set([...required, ...selectableIds])]);
              }}
            >
              {t('runtime.pluginsSelectAll')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              disabled={disabled || busyUninstall || busyInstall}
              onClick={() => onChange(requiredRows.map((r) => r.id))}
            >
              {t('runtime.pluginsNone')}
            </Button>
          </FormActions>
          <FormHint>{t('runtime.pluginsInstallNote')}</FormHint>
          {showInstallButton ? (
            <InstallStreamPanel lines={installLog} busy={busyInstall} />
          ) : null}
        </>
      ) : installed.length > 0 ? (
        <FormHint>{t('runtime.pluginsAllInstalled')}</FormHint>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmUninstall)}
        title={t('runtime.pluginUninstallConfirmTitle')}
        description={
          confirmUninstall
            ? t('runtime.pluginUninstallConfirm', { name: confirmUninstall.label })
            : ''
        }
        confirmLabel={t('runtime.pluginUninstall')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busyUninstall}
        onConfirm={() => {
          if (confirmUninstall) void doUninstall(confirmUninstall);
        }}
        onClose={() => {
          if (!busyUninstall) setConfirmUninstall(null);
        }}
      />
      <ConfirmDialog
        open={batchUninstall}
        title={t('runtime.pluginUninstallConfirmTitle')}
        description={t('runtime.pluginBatchUninstallConfirm', {
          n: uninstallSelected.length,
          defaultValue: `將卸載 ${uninstallSelected.length} 個已選工具。`,
        })}
        confirmLabel={t('runtime.pluginUninstall')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busyUninstall}
        onConfirm={() => {
          void runUninstallIds(
            uninstallSelected,
            t('runtime.pluginBatchLabel', { defaultValue: '選定工具' }),
          );
        }}
        onClose={() => {
          if (!busyUninstall) setBatchUninstall(false);
        }}
      />
    </div>
  );
}
