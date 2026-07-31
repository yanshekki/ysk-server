/**
 * Vitest + Testing Library setup for @ysk/web.
 * Fixed locale en for locale-agnostic assertions.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll } from 'vitest';
import i18n from '../shared/lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('en');
  try {
    localStorage.setItem('ysk.locale', 'en');
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
});
