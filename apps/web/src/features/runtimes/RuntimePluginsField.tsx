/**
 * Companion tools for runtimes (pm2, poetry, maven, …).
 * Install: multi-select only items not yet on host.
 * Uninstall: separate list of installed tools with confirm.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  FormActions,
  FormHint,
  MultiCheckSelect,
} from '../../shared/components/ui';
import type { MultiCheckOption } from '../../shared/components/ui';
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
}: {
  kind: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RuntimePluginRow[]>([]);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyUninstall, setBusyUninstall] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState<RuntimePluginRow | null>(null);

  const load = useCallback(async () => {
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
      try {
        const r = await systemApi.runtimeAddons(kind);
        items = r.items ?? [];
        defs = r.defaults ?? [];
      } catch {
        const r = await systemApi.runtimePlugins(kind);
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
      const mapped: RuntimePluginRow[] = items.map((p) => ({
        id: p.id,
        label: p.label,
        hint: p.hint,
        group: p.group,
        recommended: Boolean(p.recommended),
        required: Boolean(p.required),
        installed: Boolean(p.installed),
      }));
      setRows(mapped);
      setDefaults(defs);
      setLoaded(true);
      // Drop already-installed ids from install selection
      const installedIds = new Set(mapped.filter((r) => r.installed).map((r) => r.id));
      if (value.some((id) => installedIds.has(id))) {
        onChange(value.filter((id) => !installedIds.has(id)));
      }
    } catch {
      setRows([]);
      setDefaults([]);
      setLoaded(true);
    }
    // value/onChange intentionally omitted — only strip on catalog load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, t]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const doUninstall = useCallback(
    async (plugin: RuntimePluginRow) => {
      setBusyUninstall(true);
      try {
        const r = (await systemApi.runtimePluginsUninstall({
          kind: kind as
            | 'node'
            | 'python'
            | 'go'
            | 'rust'
            | 'java'
            | 'kotlin'
            | 'bun',
          plugins: [plugin.id],
        })) as { ok?: boolean; notes?: string[]; blocked?: boolean; blockMessage?: string };
        if (r.blocked) {
          toast.warn(r.blockMessage ?? r.notes?.[0] ?? t('runtime.pluginUninstallBlocked'));
        } else if (r.ok === false) {
          toast.error(r.notes?.[0] ?? t('runtime.pluginUninstallFailed', { name: plugin.label }));
        } else {
          toast.ok(t('runtime.pluginUninstalled', { name: plugin.label }));
        }
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('runtime.pluginUninstallFailed', { name: plugin.label }));
      } finally {
        setBusyUninstall(false);
        setConfirmUninstall(null);
      }
    },
    [kind, load, t],
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
              {installed.map((p) => (
                <li key={p.id} className="runtime-plugins__row">
                  <div className="runtime-plugins__meta">
                    <span className="runtime-plugins__name">{p.label}</span>
                    <Badge tone="ok">{t('runtime.pluginStatusInstalled')}</Badge>
                    {p.hint ? (
                      <code className="runtime-plugins__hint muted u-text-sm">{p.hint}</code>
                    ) : null}
                  </div>
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
              ))}
            </ul>
          </Field>
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
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || busyUninstall || !recommendedAvailable.length}
              onClick={() => onChange([...recommendedAvailable])}
            >
              {t('runtime.pluginsRecommended')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || busyUninstall || !selectableIds.length}
              onClick={() => {
                const required = requiredRows.map((r) => r.id);
                onChange([...new Set([...required, ...selectableIds])]);
              }}
            >
              {t('runtime.pluginsSelectAll')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || busyUninstall}
              onClick={() => onChange(requiredRows.map((r) => r.id))}
            >
              {t('runtime.pluginsNone')}
            </Button>
          </FormActions>
          <FormHint>{t('runtime.pluginsInstallNote')}</FormHint>
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
    </div>
  );
}
