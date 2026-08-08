/**
 * One-time short-lived tickets for WebSocket terminal auth (avoid long Bearer in query logs).
 */

import { randomBytes } from 'node:crypto';

export type TerminalTicketRecord = {
  ticket: string;
  sessionId: string;
  actor: string;
  actorUserId?: string;
  /** root | project:<id> */
  targetKey: string;
  linuxUser: string;
  projectId?: string;
  projectName?: string;
  cols: number;
  rows: number;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
};

export type TerminalTicketStore = {
  issue(input: Omit<TerminalTicketRecord, 'ticket' | 'createdAt' | 'expiresAt' | 'consumed' | 'sessionId'> & {
    sessionId?: string;
    ttlMs?: number;
  }): TerminalTicketRecord;
  /** Consume once if valid; returns null if missing/expired/used */
  consume(ticket: string): TerminalTicketRecord | null;
  purgeExpired(now?: number): number;
  size(): number;
};

const DEFAULT_TTL_MS = 60_000;

export function createTerminalTicketStore(opts?: {
  ttlMs?: number;
  now?: () => number;
}): TerminalTicketStore {
  const map = new Map<string, TerminalTicketRecord>();
  const ttlDefault = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const nowFn = opts?.now ?? (() => Date.now());

  return {
    issue(input) {
      const now = nowFn();
      const ticket = randomBytes(24).toString('base64url');
      const sessionId = input.sessionId || randomBytes(12).toString('hex');
      const rec: TerminalTicketRecord = {
        ticket,
        sessionId,
        actor: input.actor,
        actorUserId: input.actorUserId,
        targetKey: input.targetKey,
        linuxUser: input.linuxUser,
        projectId: input.projectId,
        projectName: input.projectName,
        cols: input.cols,
        rows: input.rows,
        createdAt: now,
        expiresAt: now + (input.ttlMs ?? ttlDefault),
        consumed: false,
      };
      map.set(ticket, rec);
      // opportunistic purge
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
