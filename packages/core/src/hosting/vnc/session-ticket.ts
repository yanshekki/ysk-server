/**
 * One-time short-lived tickets for browser VNC WebSocket (RFB proxy).
 * Avoid putting long-lived Bearer tokens in query strings.
 */

import { randomBytes } from 'node:crypto';

export type VncSessionKind = 'account' | 'client';

export type VncSessionTicketRecord = {
  ticket: string;
  sessionId: string;
  actor: string;
  actorUserId?: string;
  kind: VncSessionKind;
  /** account or client profile id */
  targetId: string;
  label: string;
  /** RFB host reachable from the control plane process */
  rfbHost: string;
  rfbPort: number;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
};

export type VncSessionTicketStore = {
  issue(
    input: Omit<
      VncSessionTicketRecord,
      'ticket' | 'createdAt' | 'expiresAt' | 'consumed' | 'sessionId'
    > & {
      sessionId?: string;
      ttlMs?: number;
    },
  ): VncSessionTicketRecord;
  consume(ticket: string): VncSessionTicketRecord | null;
  purgeExpired(now?: number): number;
  size(): number;
};

const DEFAULT_TTL_MS = 90_000;

export function createVncSessionTicketStore(opts?: {
  ttlMs?: number;
  now?: () => number;
}): VncSessionTicketStore {
  const map = new Map<string, VncSessionTicketRecord>();
  const ttlDefault = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const nowFn = opts?.now ?? (() => Date.now());

  return {
    issue(input) {
      const now = nowFn();
      const ticket = randomBytes(24).toString('base64url');
      const sessionId = input.sessionId || randomBytes(12).toString('hex');
      const rec: VncSessionTicketRecord = {
        ticket,
        sessionId,
        actor: input.actor,
        actorUserId: input.actorUserId,
        kind: input.kind,
        targetId: input.targetId,
        label: input.label,
        rfbHost: input.rfbHost,
        rfbPort: input.rfbPort,
        createdAt: now,
        expiresAt: now + (input.ttlMs ?? ttlDefault),
        consumed: false,
      };
      map.set(ticket, rec);
      if (map.size > 200) this.purgeExpired(now);
      return rec;
    },
    consume(ticket) {
      const now = nowFn();
      const rec = map.get(ticket);
      if (!rec) return null;
      if (rec.consumed || rec.expiresAt < now) {
        map.delete(ticket);
        return null;
      }
      rec.consumed = true;
      map.delete(ticket);
      return rec;
    },
    purgeExpired(now = nowFn()) {
      let n = 0;
      for (const [k, v] of map) {
        if (v.expiresAt < now || v.consumed) {
          map.delete(k);
          n += 1;
        }
      }
      return n;
    },
    size() {
      return map.size;
    },
  };
}
