/**
 * Preflight TCP reachability for RFB targets (before minting a browser session ticket).
 */

import { connect as netConnect } from 'node:net';
import { tl } from '@ysk/shared';

export type RfbProbeResult =
  | { ok: true }
  | { ok: false; code: string; detail: string; noteKey: string; noteParams: Record<string, string> };

const DEFAULT_TIMEOUT_MS = 5_000;

export function classifyRfbProbeError(
  e: unknown,
  host: string,
  port: number,
): { code: string; noteKey: string; noteParams: Record<string, string> } {
  const err = e as NodeJS.ErrnoException;
  const c = String(err?.code || '');
  const msg = String(err?.message || e || '');
  const target = `${host}:${port}`;
  if (c === 'ECONNREFUSED' || /refused/i.test(msg)) {
    return {
      code: 'rfb_refused',
      noteKey: 'notes.vnc.probeRefused',
      noteParams: { host, port: String(port), target },
    };
  }
  if (c === 'ETIMEDOUT' || c === 'EHOSTUNREACH' || /timeout/i.test(msg)) {
    return {
      code: 'rfb_timeout',
      noteKey: 'notes.vnc.probeTimeout',
      noteParams: { host, port: String(port), target },
    };
  }
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN' || /getaddrinfo|ENOTFOUND/i.test(msg)) {
    return {
      code: 'rfb_dns',
      noteKey: 'notes.vnc.probeDns',
      noteParams: { host },
    };
  }
  if (c === 'ENETUNREACH') {
    return {
      code: 'rfb_net',
      noteKey: 'notes.vnc.probeNet',
      noteParams: { host, port: String(port), target },
    };
  }
  return {
    code: 'rfb_error',
    noteKey: 'notes.vnc.probeFailed',
    noteParams: { target, detail: msg.slice(0, 120) },
  };
}

/** TCP connect probe; does not speak RFB — only reachability. */
export function probeRfbTcp(
  host: string,
  port: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RfbProbeResult> {
  const h = String(host || '').trim();
  const p = Number(port);
  if (!h || !Number.isInteger(p) || p < 1 || p > 65535) {
    return Promise.resolve({
      ok: false,
      code: 'rfb_invalid',
      detail: 'invalid host/port',
      noteKey: 'notes.vnc.probeInvalid',
      noteParams: { host: h || '?', port: String(p || '?') },
    });
  }

  return new Promise((resolve) => {
    const sock = netConnect({ host: h, port: p }, () => {
      sock.destroy();
      resolve({ ok: true });
    });
    sock.setTimeout(timeoutMs, () => {
      sock.destroy();
      const c = classifyRfbProbeError(
        Object.assign(new Error(`timeout ${h}:${p}`), { code: 'ETIMEDOUT' }),
        h,
        p,
      );
      resolve({
        ok: false,
        code: c.code,
        detail: `timeout ${h}:${p}`,
        noteKey: c.noteKey,
        noteParams: c.noteParams,
      });
    });
    sock.on('error', (err) => {
      const c = classifyRfbProbeError(err, h, p);
      resolve({
        ok: false,
        code: c.code,
        detail: err.message || c.code,
        noteKey: c.noteKey,
        noteParams: c.noteParams,
      });
    });
  });
}

export function probeResultNote(r: Extract<RfbProbeResult, { ok: false }>): string {
  try {
    return tl(r.noteKey as never, r.noteParams);
  } catch {
    return r.detail;
  }
}
