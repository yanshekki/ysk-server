import { describe, expect, it } from 'vitest';
import {
  parseProcStat,
  jiffiesToPct,
  parseMeminfo,
  parseTaskStates,
  parseUptime,
  parseLoadavg,
} from './top-snapshot.js';

describe('parseProcStat', () => {
  it('parses aggregate and per-cpu lines', () => {
    const sample = `
cpu  100 10 50 800 20 0 5 0 0 0
cpu0 50 5 25 400 10 0 2 0 0 0
cpu1 50 5 25 400 10 0 3 0 0 0
intr 1
`.trim();
    const p = parseProcStat(sample);
    expect(p.total?.user).toBe(100);
    expect(p.cpus).toHaveLength(2);
    expect(p.cpus[1].softirq).toBe(3);
  });
});

describe('jiffiesToPct', () => {
  it('computes deltas into percentages', () => {
    const a = {
      user: 100,
      nice: 0,
      system: 50,
      idle: 800,
      iowait: 50,
      irq: 0,
      softirq: 0,
      steal: 0,
    };
    const b = {
      user: 200,
      nice: 0,
      system: 100,
      idle: 850,
      iowait: 50,
      irq: 0,
      softirq: 0,
      steal: 0,
    };
    // delta total = 100+50+50 = 200; us=50% sy=25% id=25%
    const pct = jiffiesToPct(a, b);
    expect(pct.us).toBe(50);
    expect(pct.sy).toBe(25);
    expect(pct.id).toBe(25);
    expect(pct.busyPct).toBe(75);
  });
});

describe('parseMeminfo', () => {
  it('parses mem and swap', () => {
    const sample = `
MemTotal:       16000000 kB
MemFree:         2000000 kB
MemAvailable:    5000000 kB
Buffers:          500000 kB
Cached:          3000000 kB
SReclaimable:     200000 kB
SwapTotal:       8000000 kB
SwapFree:        2000000 kB
`.trim();
    const { memory, swap } = parseMeminfo(sample);
    expect(memory.totalKiB).toBe(16_000_000);
    expect(memory.availableKiB).toBe(5_000_000);
    expect(memory.usedKiB).toBe(11_000_000);
    expect(swap.usedKiB).toBe(6_000_000);
  });
});

describe('parseTaskStates', () => {
  it('counts R S Z T', () => {
    const sample = `
R
S
S
Z
T
D
`.trim();
    const t = parseTaskStates(sample);
    expect(t.total).toBe(6);
    expect(t.running).toBe(1);
    expect(t.zombie).toBe(1);
    expect(t.stopped).toBe(1);
    expect(t.sleeping).toBe(3); // S S D
  });
});

describe('parseUptime / loadavg', () => {
  it('parses numbers', () => {
    expect(parseUptime('44523.12 123.4')).toBeCloseTo(44523.12);
    const la = parseLoadavg('1.86 2.46 2.11 2/372 99');
    expect(la.loadavg[0]).toBeCloseTo(1.86);
    expect(la.loadavg[2]).toBeCloseTo(2.11);
  });
});
