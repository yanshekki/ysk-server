import { describe, expect, it } from 'vitest';
import {
  isSafeAutoconfigDomain,
  renderMozillaAutoconfig,
  renderOutlookAutodiscover,
} from './autodiscover.js';

describe('autodiscover XML', () => {
  it('rejects injected domain tokens', () => {
    expect(isSafeAutoconfigDomain('example.com')).toBe(true);
    expect(isSafeAutoconfigDomain('ex.com</domain><x>')).toBe(false);
    const m = renderMozillaAutoconfig({ domain: 'ex.com</domain><evil>' });
    expect(m).not.toContain('<evil>');
    expect(m).toContain('localhost');
    const o = renderOutlookAutodiscover({
      domain: 'example.com',
      email: 'a@example.com</LoginName><x>',
    });
    expect(o).not.toContain('<x>');
    expect(o).toContain('user@example.com');
  });

  it('renders mozilla and outlook configs', () => {
    const m = renderMozillaAutoconfig({ domain: 'example.com' });
    expect(m).toContain('example.com');
    expect(m).toContain('mail.example.com');
    expect(m).toContain('<port>993</port>');
    const o = renderOutlookAutodiscover({
      domain: 'example.com',
      email: 'a@example.com',
      imapHost: 'imap.example.com',
    });
    expect(o).toContain('Autodiscover');
    expect(o).toContain('imap.example.com');
    expect(o).toContain('a@example.com');
  });
});
