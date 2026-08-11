/**
 * In-page software version status + update / uninstall actions.
 * Versions come from GET /system/software/versions — never hardcode pins here.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { systemApi } from '../../../features/system';
import { updatesApi } from '../../../features/updates';
import { softwareApi } from '../../../features/software/api';
import { toast } from '../../stores/toast-store';
import {
  isAbortError,
  useOpsStreamOptional,
} from '../../ops-stream/OpsStreamContext';
import { Badge } from './Badge';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { SoftwareUninstallDialog } from './SoftwareUninstallDialog';

export type SoftwareVersionBarProps = {
  /** Probe / catalog id: nginx, mysql-server, node, go, … */
  softwareId: string;
  /** Optional display name (defaults to packageName or softwareId). */
  title?: string;
  /** Prefer runtime install callback when updateKind=runtime */
  onRuntimeInstall?: (version: string) => void | Promise<void>;
  /** Show uninstall control when installed (default true). */
  allowUninstall?: boolean;
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
  title,
  onRuntimeInstall,
  allowUninstall = true,
  className }: SoftwareVersionBarProps) {
  const { t } = useTranslation();
  const stream = useOpsStreamOptional();
  const [st, setSt] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        const r = await systemApi.softwareVersions({
          id: softwareId,
          refresh });
        const next: Status = {
          installed: Boolean(r.installed),
          currentVersion: r.currentVersion,
          latestVersion: r.latestVersion,
          upgradable: Boolean(r.upgradable),
          updateKind: r.updateKind ?? 'none',
          packageName: r.packageName,
          candidates: (r.candidates ?? []).map((c) => ({
            version: c.version,
            label: c.label })),
          source: r.source,
          notes: r.notes ?? [] };
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
          toast.error(t('software.version.noTarget'));
          return;
        }
        if (onRuntimeInstall) {
          await onRuntimeInstall(ver);
        } else {
          toast.error(t('software.version.needRuntimePage'));
        }
      } else if (st.updateKind === 'apt') {
        const pkg = st.packageName || softwareId;
        const cur = st.currentVersion || '';
        const cand = selected || st.latestVersion || '';
        if (!cand || cand === cur) {
          toast.error(t('software.version.noAptCandidate'));
          return;
        }
        const r = await updatesApi.applyPackage({
          packageName: pkg,
          currentVersion: cur,
          candidateVersion: cand,
          confirmHighRisk: true });
        if (r.blocked) {
          toast.error(r.blockMessage || t('software.apply.blocked'));
        } else if (r.ok && r.applied) {
          toast.ok(t('software.apply.ok', { pkg }));
          setConfirmOpen(false);
          await load(true);
        } else {
          toast.error(
            (r.notes ?? []).slice(0, 2).join(' · ') || t('software.apply.failed'),
          );
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function runUninstall(opts: {
    dataPolicy: 'keep' | 'purge';
    confirmPhrase: string;
  }) {
    if (stream?.isBusy) {
      toast.error(t('softwareLifecycle.jobInProgress'));
      return;
    }
    const label = title?.trim() || st?.packageName || softwareId;
    const started = stream
      ? stream.begin({ kind: 'uninstall', title: label })
      : null;
    const jobId = started?.id ?? '';
    const signal = started?.signal;
    setBusy(true);
    try {
      const { ops } = await softwareApi.uninstallStream(
        {
          ids: [softwareId],
          dataPolicy: opts.dataPolicy,
          confirmPhrase: opts.confirmPhrase,
        },
        {
          onLog: (line) => {
            if (jobId && stream) stream.appendLog(jobId, line);
          },
          signal,
        },
      );
      if (stream && jobId) {
        if (signal?.aborted) {
          stream.finish(jobId, {
            ok: false,
            cancelled: true,
            error: t('softwareLifecycle.cancelHint'),
          });
          toast.error(t('softwareLifecycle.cancelledToast'));
        } else {
          stream.finish(jobId, {
            ok: ops.ok !== false && !ops.blocked,
            error: ops.blockMessage,
          });
        }
      }
      if (signal?.aborted) {
        setUninstallOpen(false);
        await load(true);
      } else if (ops.ok && !ops.blocked) {
        toast.ok(ops.notes?.[0] ?? t('softwareLifecycle.uninstallDone'));
        setUninstallOpen(false);
        await load(true);
      } else {
        toast.error(
          ops.blockMessage ||
            ops.notes?.[0] ||
            t('softwareLifecycle.uninstallFailed'),
        );
      }
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) {
        if (stream && jobId) {
          stream.finish(jobId, {
            ok: false,
            cancelled: true,
            error: t('softwareLifecycle.cancelHint'),
          });
        }
        toast.error(t('softwareLifecycle.cancelledToast'));
        setUninstallOpen(false);
        await load(true);
      } else {
        const msg = e instanceof Error ? e.message : t('common.opFailed');
        if (stream && jobId) stream.finish(jobId, { ok: false, error: msg });
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading && !st) {
    return (
      <div className={`software-version-bar muted ${className ?? ''}`.trim()}>
        {t('software.version.loading')}
      </div>
    );
  }

  if (!st) return null;

  const showUpdate =
    st.upgradable ||
    (st.updateKind === 'runtime' && Boolean(st.latestVersion)) ||
    (st.updateKind === 'apt' && st.upgradable);

  const displayName =
    title?.trim() ||
    st.packageName?.trim() ||
    softwareId;

  return (
    <div className={`software-version-bar ${className ?? ''}`.trim()}>
      <div className="software-version-bar__head">
        <strong className="software-version-bar__name">{displayName}</strong>
        <span className="muted u-text-sm">{softwareId}</span>
      </div>
      <div className="software-version-bar__row">
        <span className="software-version-bar__label">
          {t('software.version.installed')}
        </span>
        <strong>
          {st.currentVersion ||
            (st.installed ? '—' : t('software.status.notInstalled'))}
        </strong>
        <span className="software-version-bar__label">
          {t('software.version.latest')}
        </span>
        <strong>{st.latestVersion || '—'}</strong>
        {st.upgradable ? (
          <Badge tone="warn">{t('software.badge.update')}</Badge>
        ) : st.installed && st.latestVersion ? (
          <Badge tone="ok">{t('software.version.upToDate')}</Badge>
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
            aria-label={t('software.version.pick')}
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
          {t('software.version.refresh')}
        </Button>
        {showUpdate && st.updateKind === 'apt' ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            {t('software.action.update')}
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
                  v: selected || st.latestVersion })
              : t('software.action.installVersion', {
                  v: selected || st.latestVersion })}
          </Button>
        ) : null}
        {allowUninstall && st.installed ? (
          <Button
            variant="danger"
            size="sm"
            disabled={busy || stream?.isBusy}
            onClick={() => setUninstallOpen(true)}
          >
            {t('softwareLifecycle.uninstall')}
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => !busy && setConfirmOpen(false)}
        onConfirm={() => void applyUpdate()}
        title={t('software.apply.confirmTitle')}
        description={t('software.apply.confirmBody', {
          pkg: st.packageName || softwareId,
          from: st.currentVersion || '—',
          to: selected || st.latestVersion || '—' })}
        busy={busy}
        danger
        confirmLabel={t('software.apply.confirm')}
      />

      <SoftwareUninstallDialog
        open={uninstallOpen}
        ids={[softwareId]}
        title={displayName}
        busy={busy}
        onClose={() => !busy && setUninstallOpen(false)}
        onConfirm={runUninstall}
      />
    </div>
  );
}
