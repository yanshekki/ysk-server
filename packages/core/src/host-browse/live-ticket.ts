/**
 * One-time tickets for host-browse live WebSocket (browser engine screencast).
 */

import { randomBytes } from 'node:crypto';

export type HostBrowseLiveTicket = {
  ticket: string;
  sessionId: string;
  userId: string;
  expiresAt: number;
};

export type HostBrowseLiveTicketStore = {
  issue: (input: {
    sessionId: string;
    userId: string;
    ttlMs?: number;
  }) => HostBrowseLiveTicket;
  consume: (ticket: string) => HostBrowseLiveTicket | null;
};

export function createHostBrowseLiveTicketStore(): HostBrowseLiveTicketStore {
  const map = new Map<string, HostBrowseLiveTicket>();

  const purge = () => {
    const now = Date.now();
    for (const [k, v] of map) {
      if (v.expiresAt <= now) map.delete(k);
    }
  };

  return {
    issue(input) {
      purge();
      const ticket = randomBytes(24).toString('base64url');
      const rec: HostBrowseLiveTicket = {
        ticket,
        sessionId: input.sessionId,
        userId: input.userId,
        expiresAt: Date.now() + (input.ttlMs ?? 60_000),
      };
      map.set(ticket, rec);
      return rec;
    },
    consume(ticket) {
      purge();
      const rec = map.get(ticket);
      if (!rec) return null;
      map.delete(ticket);
      if (rec.expiresAt <= Date.now()) return null;
      return rec;
    },
  };
}
