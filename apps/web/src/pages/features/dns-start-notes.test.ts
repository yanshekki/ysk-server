import { describe, expect, it } from 'vitest';
import { pickDnsStartFailureNotes } from './dns-start-notes';

describe('pickDnsStartFailureNotes', () => {
  it('prefers bind-conflict over no-active-unit', () => {
    const r = pickDnsStartFailureNotes(
      [
        '沒有運行中的 named／bind9／pdns 單元',
        'PowerDNS 無法綁定 0.0.0.0:53（埠被佔用），多與 systemd-resolved 衝突。',
        "Unable to bind UDP socket to '0.0.0.0:53': Address already in use",
      ],
      'hint',
      'not listening',
    );
    expect(r.blockMessage).toMatch(/0\.0\.0\.0:53|埠被佔用/);
    expect(r.notes[0]).toBe(r.blockMessage);
    expect(r.notes.some((n) => /Unable to bind/i.test(n))).toBe(true);
    expect(r.notes).toContain('hint');
    expect(r.blockMessage).not.toMatch(/named／bind9/);
  });

  it('falls back to hint then empty-state copy', () => {
    expect(pickDnsStartFailureNotes([], 'hint', 'empty').blockMessage).toBe('hint');
    expect(pickDnsStartFailureNotes(undefined, '', 'empty').blockMessage).toBe('empty');
  });
});
