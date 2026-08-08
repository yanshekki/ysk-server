import { describe, expect, it } from 'vitest';
import { createTerminalTicketStore } from './tickets.js';

describe('terminal tickets', () => {
  it('issues and consumes once', () => {
    let now = 1_000_000;
    const store = createTerminalTicketStore({ now: () => now, ttlMs: 1000 });
    const t = store.issue({
      actor: 'admin',
      targetKey: 'root',
      linuxUser: 'root',
      cols: 80,
      rows: 24,
    });
    expect(t.ticket.length).toBeGreaterThan(10);
    const a = store.consume(t.ticket);
    expect(a?.linuxUser).toBe('root');
    expect(store.consume(t.ticket)).toBeNull();
  });

  it('expires', () => {
    let now = 1_000_000;
    const store = createTerminalTicketStore({ now: () => now, ttlMs: 100 });
    const t = store.issue({
      actor: 'admin',
      targetKey: 'root',
      linuxUser: 'root',
      cols: 80,
      rows: 24,
    });
    now += 500;
    expect(store.consume(t.ticket)).toBeNull();
  });
});
