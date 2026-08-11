import { describe, expect, it } from 'vitest';
import { createVncSessionTicketStore } from './session-ticket.js';

describe('vnc session tickets', () => {
  it('issues and consumes once', () => {
    let now = 1_000;
    const store = createVncSessionTicketStore({ now: () => now, ttlMs: 1000 });
    const rec = store.issue({
      actor: 'admin',
      kind: 'client',
      targetId: 'c1',
      label: 'hermes',
      rfbHost: '127.0.0.1',
      rfbPort: 5901,
    });
    expect(rec.ticket.length).toBeGreaterThan(10);
    expect(store.consume(rec.ticket)?.label).toBe('hermes');
    expect(store.consume(rec.ticket)).toBeNull();
  });

  it('expires', () => {
    let now = 1_000;
    const store = createVncSessionTicketStore({ now: () => now, ttlMs: 100 });
    const rec = store.issue({
      actor: 'admin',
      kind: 'account',
      targetId: 'a1',
      label: 'desk',
      rfbHost: '127.0.0.1',
      rfbPort: 5901,
    });
    now = 2_000;
    expect(store.consume(rec.ticket)).toBeNull();
  });
});
