import { expect } from 'vitest';

/**
 * Track peak rendered text length across multi-step hammers that unmount.
 * Call sample() while the tree is mounted; assertRendered() at the end.
 */
export function createUiProbe() {
  let maxChars = 0;
  return {
    sample() {
      const n = (document.body?.textContent ?? '').replace(/\s+/g, ' ').trim().length;
      if (n > maxChars) maxChars = n;
    },
    assertRendered(min = 10) {
      expect(maxChars).toBeGreaterThanOrEqual(min);
    },
    get maxChars() {
      return maxChars;
    },
  };
}

/** Assert current mounted document has meaningful UI text. */
export function assertMountedUi(min = 10) {
  const n = (document.body?.textContent ?? '').replace(/\s+/g, ' ').trim().length;
  expect(n).toBeGreaterThanOrEqual(min);
}
