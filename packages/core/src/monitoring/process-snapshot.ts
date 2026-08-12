import { tl } from 'ysk-server-shared';
/**
 * Process table snapshot — real `ps` + top-style header (honest, no fake rows).
 */

import type {
  ProcessRowDto,
  ProcessSnapshotDto,
  ProcessSort,
} from 'ysk-server-shared';
import type { HostExecutor } from '../host/executor.js';
import { collectTopHeader } from './top-snapshot.js';

export type ProcessRow = ProcessRowDto;
export type ProcessSnapshot = ProcessSnapshotDto;
export type { ProcessSort };

function parseKiB(raw: string): number | undefined {
  const t = raw.trim().toUpperCase();
  if (!t || t === '-') return undefined;
  // plain number (ps vsz/rss often KiB)
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  // 1.4g / 53.6g style from some ps formats — rare with -o vsz
  const m = t.match(/^([\d.]+)([KMG])?$/);
  if (!m) return undefined;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const u = m[2];
  if (u === 'G') n *= 1024 * 1024;
  else if (u === 'M') n *= 1024;
  else if (u === 'K' || !u) {
    /* already KiB-ish */
  }
  return Math.round(n);
}

/**
 * Parse rich `ps -eo pid,user,pri,ni,vsz,rss,stat,pcpu,pmem,time,etime,args`.
 * Also accepts simpler legacy layouts.
 */
export function parsePsOutput(stdout: string, limit: number): ProcessRow[] {
  const lines = stdout.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const rows: ProcessRow[] = [];

  for (const line of lines.slice(1)) {
    const t = line.trim();
    // Full: pid user pri ni vsz rss stat pcpu pmem time etime args
    // STAT may be multi-char (Ss, Rsl…); TIME/ELAPSED are single tokens
    const full = t.match(
      /^(\d+)\s+(\S+)\s+(\S+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(\S+)\s+(.*)$/,
    );
    if (full) {
      const cpu = Number(full[8]);
      const mem = Number(full[9]);
      if (!Number.isFinite(cpu) || !Number.isFinite(mem)) continue;
      rows.push({
        pid: full[1],
        user: full[2],
        pr: full[3],
        ni: Number(full[4]),
        virtKiB: parseKiB(full[5]),
        resKiB: parseKiB(full[6]),
        state: full[7],
        cpu,
        mem,
        timePlus: full[10],
        etime: full[11],
        command: (full[12] || '').trim().slice(0, 200) || '—',
      });
      if (rows.length >= limit) break;
      continue;
    }

    // Mid: pid user pcpu pmem etime args
    const withEtime = t.match(
      /^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+-\d+:\d+:\d+|\d+:\d+:\d+|\d+:\d+)\s+(.*)$/,
    );
    if (withEtime) {
      const cpu = Number(withEtime[3]);
      const mem = Number(withEtime[4]);
      if (!Number.isFinite(cpu) || !Number.isFinite(mem)) continue;
      rows.push({
        pid: withEtime[1],
        user: withEtime[2],
        cpu,
        mem,
        etime: withEtime[5],
        command: (withEtime[6] || '').trim().slice(0, 200) || '—',
      });
      if (rows.length >= limit) break;
      continue;
    }

    // Legacy: pid user pcpu pmem args
    const m = t.match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.*)$/);
    if (!m) continue;
    const cpu = Number(m[3]);
    const mem = Number(m[4]);
    if (!Number.isFinite(cpu) || !Number.isFinite(mem)) continue;
    rows.push({
      pid: m[1],
      user: m[2],
      cpu,
      mem,
      command: (m[5] || '').trim().slice(0, 200) || '—',
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

function sortRows(rows: ProcessRow[], sort: ProcessSort): ProcessRow[] {
  const copy = [...rows];
  if (sort === 'mem') copy.sort((a, b) => b.mem - a.mem);
  else if (sort === 'pid') copy.sort((a, b) => Number(a.pid) - Number(b.pid));
  else if (sort === 'time') {
    // Prefer timePlus string length/heuristic: longer cumulative often larger; fallback cpu
    copy.sort((a, b) => {
      const ta = a.timePlus ?? a.etime ?? '';
      const tb = b.timePlus ?? b.etime ?? '';
      if (ta !== tb) {
        // dd-hh:mm:ss vs mm:ss — longer string or more separators ≈ more time
        if (ta.length !== tb.length) return tb.length - ta.length;
        return tb.localeCompare(ta);
      }
      return b.cpu - a.cpu;
    });
  } else copy.sort((a, b) => b.cpu - a.cpu);
  return copy;
}

export async function collectProcessSnapshot(
  host: HostExecutor,
  opts?: {
    sort?: ProcessSort;
    limit?: number;
    includeTop?: boolean;
    includeHeader?: boolean;
    sampleMs?: number;
  },
): Promise<ProcessSnapshot> {
  const sort: ProcessSort =
    opts?.sort === 'mem' || opts?.sort === 'time' || opts?.sort === 'pid'
      ? opts.sort
      : 'cpu';
  const limit = Math.max(5, Math.min(100, opts?.limit ?? 40));
  const notes: string[] = [];
  const at = new Date().toISOString();
  const includeHeader = opts?.includeHeader !== false;

  // Fetch header in parallel with process list (header needs ~sampleMs itself)
  const headerPromise = includeHeader
    ? collectTopHeader(host, { sampleMs: opts?.sampleMs }).catch((e) => {
        notes.push(
          tl('notes.auto.t0438', { v0: (e instanceof Error ? e.message : String(e)) }),
        );
        return undefined;
      })
    : Promise.resolve(undefined);

  const sortFlag =
    sort === 'mem'
      ? '-pmem'
      : sort === 'pid'
        ? 'pid'
        : sort === 'time'
          ? '-time'
          : '-pcpu';

  // Full top-like columns; args last
  const psFields = 'pid,user,pri,ni,vsz,rss,stat,pcpu,pmem,time,etime,args';
  const psCmd = ['ps', '-eo', psFields, `--sort=${sortFlag}`];
  const ps = await host.runCommand(psCmd, { timeoutMs: 10_000 });

  let rows: ProcessRow[] = [];
  if (ps.exitCode !== 0) {
    notes.push(tl('notes.auto.t0439', { v0: ((ps.stderr || ps.stdout).slice(0, 160)) }));
    const ps2 = await host.runCommand(
      ['ps', '-eo', 'pid,user,pcpu,pmem,etime,args', '--sort=-pcpu'],
      { timeoutMs: 8_000 },
    );
    if (ps2.exitCode !== 0) {
      const ps3 = await host.runCommand(
        ['ps', '-eo', 'pid,user,pcpu,pmem,args'],
        { timeoutMs: 8_000 },
      );
      if (ps3.exitCode !== 0) {
        notes.push(tl('notes.auto.n1002'));
        const topHeader = await headerPromise;
        return {
          ok: false,
          at,
          sort,
          limit,
          rows: [],
          topHeader,
          notes,
        };
      }
      rows = sortRows(parsePsOutput(ps3.stdout, limit * 2), sort).slice(0, limit);
      notes.push(tl('notes.auto.n0392'));
    } else {
      rows = sortRows(parsePsOutput(ps2.stdout, limit * 2), sort).slice(0, limit);
      notes.push(tl('notes.auto.n0393'));
    }
  } else {
    rows = parsePsOutput(ps.stdout, limit);
    // If sort flag unsupported silently, re-sort client-side
    if (sort !== 'cpu') {
      rows = sortRows(rows, sort).slice(0, limit);
    }
  }

  if (!rows.length) {
    notes.push(tl('notes.auto.n0391'));
    const topHeader = await headerPromise;
    return { ok: false, at, sort, limit, rows: [], topHeader, notes };
  }

  let rawTop: string | undefined;
  if (opts?.includeTop) {
    const top = await host.runCommand(
      ['bash', '-c', 'top -b -n 1 -w 512 2>/dev/null | head -n 40'],
      { timeoutMs: 8_000 },
    );
    if (top.exitCode === 0 && top.stdout.trim()) {
      rawTop = top.stdout.trim().slice(0, 6000);
    } else {
      notes.push(tl('notes.auto.n0448'));
    }
  }

  const topHeader = await headerPromise;
  if (topHeader?.notes?.length) {
    notes.push(...topHeader.notes);
  }

  return {
    ok: true,
    at: topHeader?.at ?? at,
    sort,
    limit,
    rows,
    topHeader,
    rawTop,
    notes,
  };
}
