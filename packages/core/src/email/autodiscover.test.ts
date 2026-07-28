import { describe, expect, it } from 'vitest';
import { renderMozillaAutoconfig, renderOutlookAutodiscover } from './autodiscover.js';

describe('autodiscover XML', () => {
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
