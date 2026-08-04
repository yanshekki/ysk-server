import { tl } from '@ysk/shared';
/**
 * DNS lookup tools for panel (dig-like via system dig or node dns).
 * Honest: reports tool + raw answers; never fakes records.
 */

import { resolve4, resolve6, resolveMx, resolveTxt, resolveCname } from 'node:dns/promises';
import type { HostExecutor } from '../host/executor.js';

export type DnsLookupType = 'A' | 'AAAA' | 'MX' | 'TXT' | 'CNAME' | 'NS';

export type DnsLookupResult = {
  ok: boolean;
  name: string;
  type: DnsLookupType;
  answers: string[];
  notes: string[];
  method: 'dig' | 'node-dns' | 'none';
  latencyMs?: number;
};

/**
 * Prefer `dig +short` when available; fallback to node dns.
 */
export async function lookupDns(input: {
  host?: HostExecutor;
  name: string;
  type?: DnsLookupType;
}): Promise<DnsLookupResult> {
  const name = input.name.trim().replace(/\.$/, '');
  const type = (input.type ?? 'A').toUpperCase() as DnsLookupType;
  const notes: string[] = [];
  if (!name) {
    return {
      ok: false,
      name: '',
      type,
      answers: [],
      notes: [tl('notes.auto.n1419')],
      method: 'none',
    };
  }

  const t0 = Date.now();

  if (input.host) {
    const digType = type === 'CNAME' ? 'CNAME' : type;
    const { resolveBin, shellBinExists } = await import('./software-probe/index.js');
    const digPath = await resolveBin(input.host, 'dig');
    const r = digPath
      ? await input.host.runCommand(
          [digPath, '+time=3', '+tries=1', '+short', digType, name],
          { timeoutMs: 12_000 },
        )
      : await input.host.runCommand(
          [
            'bash',
            '-c',
            `if ${shellBinExists('dig')}; then dig +time=3 +tries=1 +short ${JSON.stringify(digType)} ${JSON.stringify(name)} 2>/dev/null; else echo YSK_NO_DIG; fi`,
          ],
          { timeoutMs: 12_000 },
        );
    const out = (r.stdout || '').trim();
    if (!out.includes('YSK_NO_DIG') && r.exitCode === 0) {
      const answers = out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith(';'));
      return {
        ok: answers.length > 0,
        name,
        type,
        answers,
        notes: answers.length
          ? [`dig ${type} ${name}`]
          : [tl('notes.auto.t0259')],
        method: 'dig',
        latencyMs: Date.now() - t0,
      };
    }
    notes.push(tl('notes.auto.n0251'));
  }

  try {
    let answers: string[] = [];
    if (type === 'A') answers = await resolve4(name);
    else if (type === 'AAAA') answers = await resolve6(name);
    else if (type === 'MX') {
      const mx = await resolveMx(name);
      answers = mx
        .sort((a, b) => a.priority - b.priority)
        .map((m) => `${m.priority} ${m.exchange}`);
    } else if (type === 'TXT') {
      const txt = await resolveTxt(name);
      answers = txt.map((parts) => parts.join(''));
    } else if (type === 'CNAME') {
      answers = await resolveCname(name);
    } else if (type === 'NS') {
      const { resolveNs } = await import('node:dns/promises');
      answers = await resolveNs(name);
    }
    return {
      ok: answers.length > 0,
      name,
      type,
      answers,
      notes: [...notes, `node-dns ${type}`],
      method: 'node-dns',
      latencyMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      ok: false,
      name,
      type,
      answers: [],
      notes: [
        ...notes,
        e instanceof Error ? e.message : String(e),
      ],
      method: 'node-dns',
      latencyMs: Date.now() - t0,
    };
  }
}
