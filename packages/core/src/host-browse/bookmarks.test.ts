import { describe, expect, it } from 'vitest';
import { emptyLibrary, pushHistory, upsertBookmark } from './bookmarks.js';

describe('bookmarks library', () => {
  it('toggles bookmark', () => {
    let lib = emptyLibrary();
    lib = upsertBookmark(lib, { url: 'https://a.test', title: 'A' });
    expect(lib.bookmarks).toHaveLength(1);
    lib = upsertBookmark(lib, { url: 'https://a.test' });
    expect(lib.bookmarks).toHaveLength(0);
  });
  it('history dedupes url to front', () => {
    let lib = emptyLibrary();
    lib = pushHistory(lib, { url: 'https://a.test' });
    lib = pushHistory(lib, { url: 'https://b.test' });
    lib = pushHistory(lib, { url: 'https://a.test' });
    expect(lib.history[0].url).toBe('https://a.test');
    expect(lib.history).toHaveLength(2);
  });
});
