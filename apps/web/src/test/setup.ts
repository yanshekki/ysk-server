/**
 * Vitest + Testing Library setup for @ysk/web.
 * Fixed locale en for locale-agnostic assertions.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
