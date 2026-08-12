/**
 * Shared nav bookmarks store — AppShell sidebar + Email/Projects pages
 * must see the same list so star toggles re-render the menu immediately.
 *
 * get() returns a stable reference until set() — required by useSyncExternalStore.
 */
import type { NavBookmarks } from '../../features/nav-bookmarks/api';

type Listener = () => void;

const empty: NavBookmarks = {
  projects: [],
  emailDomains: [],
};

let snapshot: NavBookmarks = empty;
let loaded = false;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function freezeSnap(b: NavBookmarks): NavBookmarks {
  return {
    projects: [...(b.projects ?? [])],
    emailDomains: [...(b.emailDomains ?? [])],
  };
}

export const navBookmarksStore = {
  /** Stable snapshot until next set — safe for useSyncExternalStore. */
  get(): NavBookmarks {
    return snapshot;
  },
  isLoaded(): boolean {
    return loaded;
  },
  set(next: NavBookmarks | null | undefined): void {
    snapshot = freezeSnap(next ?? empty);
    loaded = true;
    emit();
  },
  /** Mark load finished even if fetch failed (keep previous). */
  markLoaded(): void {
    if (!loaded) {
      loaded = true;
      emit();
    }
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Test / logout helper */
  reset(): void {
    snapshot = empty;
    loaded = false;
    emit();
  },
};

export { empty as EMPTY_NAV_BOOKMARKS };
