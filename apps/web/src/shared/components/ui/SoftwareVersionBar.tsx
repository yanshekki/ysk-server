/**
 * In-page software version status + update action (apt or runtime).
 * Versions come from GET /system/software/versions — never hardcode pins here.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { systemApi } from '../../../features/system';
import { updatesApi } from '../../../features/updates';
import { toast } from '../../stores/toast-store';
import { Badge } from './Badge';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';

export type SoftwareVersionBarProps = {
  /** Probe / catalog id: nginx, mysql-server, node, go, … */
  softwareId: string;
  /** Prefer runtime install callback when updateKind=runtime */
  onRuntimeInstall?: (version: string) => void | Promise<void>;
  className?: string;
};

type Status = {
  installed: boolean;
  currentVersion?: string;
  latestVersion?: string;
  upgradable: boolean;
  updateKind: 'runtime' | 'apt' | 'none';
  packageName?: string;
  candidates: Array<{ version: string; label: string }>;
  source?: string;
  notes: string[];
};

export function SoftwareVersionBar({
  softwareId,
  onRuntimeInstall,
  className,
}: SoftwareVersionBarProps) {
  const { t } = useTranslation();
  const [st, setSt] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        const r = await systemApi.softwareVersions({
          id: softwareId,
          refresh,
        });
        const next: Status = {
          installed: Boolean(r.installed),
          currentVersion: r.currentVersion,
          latestVersion: r.latestVersion,
          upgradable: Boolean(r.upgradable),
          updateKind: r.updateKind ?? 'none',
          packageName: r.packageName,
          candidates: (r.candidates ?? []).map((c) => ({
            version: c.version,
            label: c.label,
          })),
          source: r.source,
          notes: r.notes ?? [],
        };
        setSt(next);
        const pick =
          next.latestVersion ||
          next.candidates[0]?.version ||
          next.currentVersion ||
          '';
        setSelected(pick);
      } catch (e) {
        setSt(null);
        toast.error(e instanceof Error ? e.message : t('common.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [softwareId, t],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  async function applyUpdate() {
    if (!st) return;
    setBusy(true);
    try {
      if (st.updateKind === 'runtime') {
        const ver = selected || st.latestVersion;
        if (!ver) {
          toast.error(
            t('software.version.noTarget', { defaultValue: t('uiInline.s69e60fb5') }),
          );
          return;
        }
        if (onRuntimeInstall) {
          await onRuntimeInstall(ver);
        } else {
          toast.error(
            t('software.version.needRuntimePage', {
              defaultValue: t('uiInline.sb4e3bb0b'),
            }),
          );
        }
      } else if (st.updateKind === 'apt') {
        const pkg = st.packageName || softwareId;
        const cur = st.currentVersion || '';
        const cand = selected || st.latestVersion || '';
        if (!cand || cand === cur) {
          toast.error(
            t('software.version.noAptCandidate', {
              defaultValue: t('uiInline.sae926193'),
            }),
          );
          return;
        }
        const r = await updatesApi.applyPackage({
          packageName: pkg,
          currentVersion: cur,
          candidateVersion: cand,
          confirmHighRisk: true,
        });
        if (r.blocked) {
          toast.error(
            r.blockMessage ||
              t('software.apply.blocked', {
                defaultValue: t('uiInline.s52573ef8'),
              }),
          );
        } else if (r.ok && r.applied) {
          toast.ok(
            t('software.apply.ok', {
              pkg,
              defaultValue: t('uiInline.s872d2fe0', { v0: pkg }),
            }),
          );
          setConfirmOpen(false);
          await load(true);
        } else {
          toast.error(
            (r.notes ?? []).slice(0, 2).join(' · ') ||
              t('software.apply.failed', { defaultValue: t('uiInline.sbb823c06') }),
          );
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !st) {
    return (
      <div className={`software-version-bar muted ${className ?? ''}`.trim()}>
        {t('software.version.loading', { defaultValue: t('uiInline.s6a93c0ec') })}
      </div>
    );
  }

  if (!st) return null;

  const showUpdate =
    st.upgradable ||
    (st.updateKind === 'runtime' && Boolean(st.latestVersion)) ||
    (st.updateKind === 'apt' && st.upgradable);

  return (
    <div className={`software-version-bar ${className ?? ''}`.trim()}>
      <div className="software-version-bar__row">
        <span className="software-version-bar__label">
          {t('software.version.installed', { defaultValue: t('uiInline.s378e49b6') })}
        </span>
        <strong>{st.currentVersion || (st.installed ? '—' : t('software.status.notInstalled', { defaultValue: t('uiInline.sbcbdbc49') }))}</strong>
        <span className="software-version-bar__label">
          {t('software.version.latest', { defaultValue: t('uiInline.s7e805a12') })}
        </span>
        <strong>{st.latestVersion || '—'}</strong>
        {st.upgradable ? (
          <Badge tone="warn">
            {t('software.badge.update', { defaultValue: t('uiInline.sbd26894e') })}
          </Badge>
        ) : st.installed && st.latestVersion ? (
          <Badge tone="ok">
            {t('software.version.upToDate', { defaultValue: t('uiInline.s74b39712') })}
          </Badge>
        ) : null}
        {st.source ? (
          <span className="muted u-text-sm" title={st.notes.join(' · ')}>
            {st.source}
          </span>
        ) : null}
      </div>
      <div className="software-version-bar__actions">
        {st.candidates.length > 1 ? (
          <select
            className="input input--sm"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label={t('software.version.pick', { defaultValue: t('uiInline.s090e6a43') })}
          >
            {st.candidates.map((c) => (
              <option key={c.version} value={c.version}>
                {c.label}
              </option>
            ))}
          </select>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          loading={loading}
          onClick={() => void load(true)}
        >
          {t('software.version.refresh', { defaultValue: t('uiInline.s03a87d5d') })}
        </Button>
        {showUpdate && st.updateKind === 'apt' ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            {t('software.action.update', { defaultValue: t('uiInline.sd9db02d0') })}
          </Button>
        ) : null}
        {st.updateKind === 'runtime' && (st.latestVersion || selected) ? (
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={() => void applyUpdate()}
          >
            {st.installed && st.upgradable
              ? t('software.action.updateTo', {
                  v: selected || st.latestVersion,
                  defaultValue: t('uiInline.s53c07a48', { v0: selected || st.latestVersion }),
                })
              : t('software.action.installVersion', {
                  v: selected || st.latestVersion,
                  defaultValue: t('uiInline.s425e8381', { v0: selected || st.latestVersion }),
                })}
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => !busy && setConfirmOpen(false)}
        onConfirm={() => void applyUpdate()}
        title={t('software.apply.confirmTitle', {
          defaultValue: t('uiInline.s00338fde'),
        })}
        description={t('software.apply.confirmBody', {
          pkg: st.packageName || softwareId,
          from: st.currentVersion || '—',
          to: selected || st.latestVersion || '—',
          defaultValue: t('uiInline.s5bd1242f', { v0: st.packageName || softwareId, v1: st.currentVersion || '—', v2: selected || st.latestVersion || '—' }),
        })}
        busy={busy}
        danger
        confirmLabel={t('software.apply.confirm', { defaultValue: t('uiInline.s0e05f4b7') })}
      />
    </div>
  );
}
