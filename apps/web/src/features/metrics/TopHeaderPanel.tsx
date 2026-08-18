/**
 * top(1)-style summary: load, tasks, %Cpu (aggregate / per-core), Mem, Swap.
 */
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../shared/lib/datetime';
import { hostTimeZoneOpts } from '../../shared/lib/host-timezone';
import type { CpuTimesPct, TopHeader } from './api';

export function formatUptime(sec: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) {
    return t('metrics.uptimeDays', {
      d,
      h,
      m: String(m).padStart(2, '0') });
  }
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function kibToHuman(kib: number): string {
  if (!Number.isFinite(kib) || kib <= 0) return '0';
  if (kib >= 1024 * 1024) return `${(kib / 1024 / 1024).toFixed(1)} GiB`;
  if (kib >= 1024) return `${(kib / 1024).toFixed(1)} MiB`;
  return `${Math.round(kib)} KiB`;
}

function CpuStackBar({
  cpu,
  label,
  compact }: {
  cpu: CpuTimesPct;
  label?: string;
  compact?: boolean;
}) {
  const segs: { key: keyof CpuTimesPct; cls: string; v: number }[] = [
    { key: 'us', cls: 'top-cpu-seg--us', v: cpu.us },
    { key: 'sy', cls: 'top-cpu-seg--sy', v: cpu.sy },
    { key: 'ni', cls: 'top-cpu-seg--ni', v: cpu.ni },
    { key: 'wa', cls: 'top-cpu-seg--wa', v: cpu.wa },
    { key: 'hi', cls: 'top-cpu-seg--hi', v: cpu.hi },
    { key: 'si', cls: 'top-cpu-seg--si', v: cpu.si },
    { key: 'st', cls: 'top-cpu-seg--st', v: cpu.st },
  ];
  return (
    <div className={`top-cpu-row${compact ? ' top-cpu-row--sm' : ''}`}>
      {label ? <span className="top-cpu-row__lab">{label}</span> : null}
      <div className="top-cpu-stack" title={`busy ${cpu.busyPct}% · idle ${cpu.id}%`}>
        {segs.map((s) =>
          s.v > 0.05 ? (
            <div
              key={s.key}
              className={`top-cpu-seg ${s.cls} u-meter-fill`}
              style={{ ['--meter-pct' as string]: `${Math.min(100, s.v)}%` }}
            />
          ) : null,
        )}
        <div
          className="top-cpu-seg top-cpu-seg--id u-meter-fill"
          style={{ ['--meter-pct' as string]: `${Math.min(100, Math.max(0, cpu.id))}%` }}
        />
      </div>
      <span className="top-cpu-row__pct">{cpu.busyPct.toFixed(1)}%</span>
    </div>
  );
}

export function TopHeaderPanel({
  header,
  perCpu,
  onTogglePerCpu }: {
  header: TopHeader | null | undefined;
  perCpu: boolean;
  onTogglePerCpu: (v: boolean) => void;
}) {
  const { t } = useTranslation();

  if (!header) {
    return (
      <div className="top-panel top-panel--empty">{t('metrics.topLoading')}</div>
    );
  }

  const { tasks, cpu, cpus, memory, swap, loadavg, uptimeSec } = header;
  const memPct =
    memory.totalKiB > 0
      ? Math.min(100, (memory.usedKiB / memory.totalKiB) * 100)
      : 0;
  const swapPct =
    swap.totalKiB > 0 ? Math.min(100, (swap.usedKiB / swap.totalKiB) * 100) : 0;

  return (
    <section className="top-panel" aria-label={t('metrics.topAria')}>
      <div className="top-panel__head">
        <div className="top-panel__title">
          <strong>top</strong>
          <span className="muted">
            {formatDateTime(header.at, hostTimeZoneOpts({ withOffset: true }))} · up{' '}
            {formatUptime(uptimeSec, t)} · load{' '}
            {loadavg.map((n) => n.toFixed(2)).join(', ')}
          </span>
        </div>
        <label className={`met-toggle${perCpu ? ' met-toggle--on' : ''}`}>
          <input
            type="checkbox"
            checked={perCpu}
            onChange={(e) => onTogglePerCpu(e.target.checked)}
          />
          <span>{t('metrics.perCore')}</span>
        </label>
      </div>

      <div className="top-panel__tasks">
        Tasks: <strong>{tasks.total}</strong> total,{' '}
        <strong className={tasks.running ? 'top-hl' : undefined}>{tasks.running}</strong>{' '}
        running, {tasks.sleeping} sleeping, {tasks.stopped} stopped,{' '}
        <strong className={tasks.zombie ? 'top-hl-warn' : undefined}>{tasks.zombie}</strong>{' '}
        zombie
      </div>

      <div className="top-panel__cpu">
        {!perCpu ? (
          <>
            <div className="top-panel__cpu-legend">
              %Cpu(s):{' '}
              <span className="top-leg top-leg--us">{cpu.us.toFixed(1)} us</span>,{' '}
              <span className="top-leg top-leg--sy">{cpu.sy.toFixed(1)} sy</span>,{' '}
              <span className="top-leg top-leg--ni">{cpu.ni.toFixed(1)} ni</span>,{' '}
              <span className="top-leg top-leg--id">{cpu.id.toFixed(1)} id</span>,{' '}
              <span className="top-leg top-leg--wa">{cpu.wa.toFixed(1)} wa</span>,{' '}
              {cpu.hi.toFixed(1)} hi, {cpu.si.toFixed(1)} si, {cpu.st.toFixed(1)} st
            </div>
            <CpuStackBar cpu={cpu} />
          </>
        ) : (
          <div className="top-panel__percpu">
            {cpus.length === 0 ? (
              <span className="muted">{t('metrics.noPerCore')}</span>
            ) : (
              cpus.map((c, i) => (
                <CpuStackBar key={i} cpu={c} label={`Cpu${i}`} compact />
              ))
            )}
          </div>
        )}
      </div>

      <div className="top-panel__memgrid">
        <div className="top-mem">
          <div className="top-mem__lab">
            MiB Mem : {kibToHuman(memory.totalKiB)} total, {kibToHuman(memory.freeKiB)} free,{' '}
            {kibToHuman(memory.usedKiB)} used, {kibToHuman(memory.buffCacheKiB)} buff/cache ·
            avail {kibToHuman(memory.availableKiB)}
          </div>
          <div className="top-mem__track">
            <div
              className="top-mem__fill top-mem__fill--mem u-meter-fill"
              style={{ ['--meter-pct' as string]: `${memPct}%` }}
            />
          </div>
        </div>
        <div className="top-mem">
          <div className="top-mem__lab">
            MiB Swap: {kibToHuman(swap.totalKiB)} total, {kibToHuman(swap.freeKiB)} free,{' '}
            {kibToHuman(swap.usedKiB)} used
          </div>
          <div className="top-mem__track">
            <div
              className={`top-mem__fill top-mem__fill--swap${
                swapPct > 50 ? ' is-high' : ''
              } u-meter-fill`}
              style={{ ['--meter-pct' as string]: `${swapPct}%` }}
            />
          </div>
        </div>
      </div>

      {header.notes?.length ? (
        <p className="top-panel__notes muted u-text-sm">{header.notes.join(' · ')}</p>
      ) : null}
    </section>
  );
}

export function formatRes(kib?: number): string {
  if (kib == null || !Number.isFinite(kib)) return '—';
  if (kib >= 1024 * 1024) return `${(kib / 1024 / 1024).toFixed(1)}g`;
  if (kib >= 1024) return `${(kib / 1024).toFixed(1)}m`;
  return String(kib);
}
