/**
 * Guards uiInline locale packs against codemod corruption
 * (raw JS `${…}`, broken `)}` tails).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../locales');
const LOCALES = ['zh-HK', 'zh-CN', 'en'] as const;
const FLAGGED = [
  's9602769e',
  's7d540128',
  's814bcc7c',
  's72cac69e',
  'sd1c15b6d',
  'sbb6c72f1',
] as const;

function load(locale: string): Record<string, string> {
  return JSON.parse(
    readFileSync(join(root, locale, 'uiInline.json'), 'utf8'),
  ) as Record<string, string>;
}

describe('uiInline locale integrity', () => {
  it('has no raw JS template fragments in any string', () => {
    for (const locale of LOCALES) {
      const data = load(locale);
      for (const [key, value] of Object.entries(data)) {
        expect(value, `${locale}.${key}`).not.toMatch(/\$\{/);
        expect(value, `${locale}.${key}`).not.toMatch(/\?\s*['"]/);
        expect(value, `${locale}.${key}`).not.toMatch(/\)\}$/);
      }
    }
  });

  it('flagged keys are valid i18n templates', () => {
    for (const locale of LOCALES) {
      const data = load(locale);
      for (const key of FLAGGED) {
        const v = data[key];
        expect(v, `${locale}.${key}`).toBeTruthy();
        expect(v).not.toMatch(/\$\{/);
        const open = (v.match(/\{\{/g) ?? []).length;
        const close = (v.match(/\}\}/g) ?? []).length;
        expect(open, `${locale}.${key} brace balance`).toBe(close);
      }
    }
  });
});
