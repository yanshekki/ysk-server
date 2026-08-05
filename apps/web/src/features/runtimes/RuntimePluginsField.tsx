/**
 * Shared multi-select for runtime companion tools (pm2, poetry, maven, …).
 * Same UX as PHP extensions: MultiCheckSelect + presets.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Field,
  FormActions,
  FormHint,
  MultiCheckSelect,
} from '../../shared/components/ui';
import type { MultiCheckOption } from '../../shared/components/ui';
import { systemApi } from '../system';

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

  const load = useCallback(async () => {
    if (kind === 'php') {
      setRows([]);
      setDefaults([]);
      setLoaded(true);
      return;
    }
    try {
      // Unified addons API (plugins mode); falls back to legacy plugins if needed
      let items: Array<{
        id: string;
        label: string;
        hint?: string;
        group?: string;
        recommended: boolean;
        required: boolean;
        installed?: boolean;
      }> = [];
      let defaults: string[] = [];
      try {
        const r = await systemApi.runtimeAddons(kind);
        items = r.items ?? [];
        defaults = r.defaults ?? [];
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
        defaults = r.defaults ?? [];
      }
      setRows(
        items.map((p) => ({
          id: p.id,
          label: p.installed ? `${p.label} ✓` : p.label,
          hint: p.installed
            ? `${p.hint ?? p.id} · ${t('runtime.pluginAlreadyOnHost')}`
            : p.hint,
          group: p.group,
          recommended: Boolean(p.recommended),
          required: Boolean(p.required),
          installed: Boolean(p.installed),
        })),
      );
      setDefaults(defaults);
      setLoaded(true);
    } catch {
      setRows([]);
      setDefaults([]);
      setLoaded(true);
    }
  }, [kind, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Seed defaults once when catalog loads and parent has empty selection
  useEffect(() => {
    if (!loaded || !defaults.length) return;
    if (value.length === 0) onChange([...defaults]);
    // only seed on first load per kind
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot seed
  }, [loaded, kind]);

  const options: MultiCheckOption[] = useMemo(
    () =>
      rows
        .filter((r) => !r.required)
        .map((r) => ({
          value: r.id,
          label: r.label,
          hint: r.hint ?? r.id,
        })),
    [rows],
  );

  // When parent holds empty selection after load, seed with defaults (skip already-on-host)
  // Handled below in effect with defaults from API.

  const selectableIds = useMemo(
    () => rows.filter((r) => !r.required).map((r) => r.id),
    [rows],
  );

  if (kind === 'php' || (loaded && rows.length === 0)) return null;

  return (
    <div className="u-mt-3">
      <Field
        label={t('runtime.pluginsSelect')}
        htmlFor={`rt-plugins-${kind}`}
        flush
        hint={t('runtime.pluginsSelectHint')}
      >
        <MultiCheckSelect
          id={`rt-plugins-${kind}`}
          options={options}
          value={value.filter((id) => selectableIds.includes(id))}
          onChange={(next) => {
            const required = rows.filter((r) => r.required).map((r) => r.id);
            onChange([...new Set([...required, ...next])]);
          }}
          searchPlaceholder={t('runtime.pluginsSearch')}
          emptyText={t('runtime.pluginsEmpty')}
          maxVisible={200}
          showSelectAll
          listSize="lg"
          listMaxHeight="22rem"
          disabled={disabled}
        />
      </Field>
      <FormActions>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || !defaults.length}
          onClick={() => onChange([...defaults])}
        >
          {t('runtime.pluginsRecommended')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !selectableIds.length}
          onClick={() => {
            const required = rows.filter((r) => r.required).map((r) => r.id);
            onChange([...new Set([...required, ...selectableIds])]);
          }}
        >
          {t('runtime.pluginsSelectAll')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onChange(rows.filter((r) => r.required).map((r) => r.id))
          }
        >
          {t('runtime.pluginsNone')}
        </Button>
      </FormActions>
      <FormHint>{t('runtime.pluginsInstallNote')}</FormHint>
    </div>
  );
}
