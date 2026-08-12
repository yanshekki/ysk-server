import { describe, expect, it } from 'vitest';
import {
  encodeInfoHashQuery,
  scrapeUrlFromAnnounce,
} from './scrape.js';

describe('bt-tracker scrape helpers', () => {
  it('encodes info_hash for query string', () => {
    const hex = 'a'.repeat(40);
    const enc = encodeInfoHashQuery(hex);
    expect(enc).toBeTruthy();
    expect(enc!.startsWith('%')).toBe(true);
    expect(enc!.split('%').length - 1).toBe(20);
    expect(encodeInfoHashQuery('nope')).toBeNull();
  });

  it('maps announce URL to scrape URL with hashes', () => {
    const hex = 'b'.repeat(40);
    const url = scrapeUrlFromAnnounce('http://127.0.0.1:8000/announce', [hex]);
    expect(url).toContain('http://127.0.0.1:8000/scrape?');
    expect(url).toContain('info_hash=');
    expect(scrapeUrlFromAnnounce('ws://x', [hex])).toBeNull();
  });
});
