import { describe, expect, it } from 'vitest';
import { createHostBrowseLiveTicketStore } from './live-ticket.js';

describe('host-browse live tickets', () => {
  it('consumes once', () => {
    const store = createHostBrowseLiveTicketStore();
    const rec = store.issue({ sessionId: 's1', userId: 'u1', ttlMs: 60_000 });
    expect(store.consume(rec.ticket)?.sessionId).toBe('s1');
    expect(store.consume(rec.ticket)).toBeNull();
  });

  it('rejects expired tickets', () => {
    const store = createHostBrowseLiveTicketStore();
    const rec = store.issue({ sessionId: 's1', userId: 'u1', ttlMs: 1 });
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(store.consume(rec.ticket)).toBeNull();
        resolve();
      }, 15);
    });
  });
});
