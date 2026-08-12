import { describe, expect, it, beforeEach } from 'vitest';
import { navBookmarksStore } from './nav-bookmarks-store';

describe('navBookmarksStore', () => {
  beforeEach(() => {
    navBookmarksStore.reset();
  });

  it('starts empty and notifies subscribers on set', () => {
    let n = 0;
    const unsub = navBookmarksStore.subscribe(() => {
      n += 1;
    });
    expect(navBookmarksStore.get()).toEqual({ projects: [], emailDomains: [] });
    expect(navBookmarksStore.isLoaded()).toBe(false);

    navBookmarksStore.set({
      projects: [{ id: 'p1', label: 'Proj', domain: 'a.example' }],
      emailDomains: [{ id: 'e1', domain: 'mail.example' }],
    });
    expect(n).toBeGreaterThanOrEqual(1);
    expect(navBookmarksStore.isLoaded()).toBe(true);
    expect(navBookmarksStore.get().emailDomains[0]?.domain).toBe('mail.example');
    expect(navBookmarksStore.get().projects[0]?.id).toBe('p1');

    // snapshot is stable until next set
    const a = navBookmarksStore.get();
    expect(navBookmarksStore.get()).toBe(a);

    unsub();
  });

  it('markLoaded does not wipe bookmarks', () => {
    navBookmarksStore.set({
      projects: [],
      emailDomains: [{ id: 'e', domain: 'keep.example' }],
    });
    navBookmarksStore.markLoaded();
    expect(navBookmarksStore.get().emailDomains[0]?.domain).toBe('keep.example');
  });
});
