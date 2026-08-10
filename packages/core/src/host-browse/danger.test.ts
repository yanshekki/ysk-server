import { describe, expect, it } from 'vitest';
import { evaluateDownloadSafety, evaluateNavigateSafety } from './danger.js';

describe('danger policy', () => {
  it('blocks non-http schemes', () => {
    expect(evaluateNavigateSafety({ url: 'file:///etc/passwd' }).action).toBe('block');
  });
  it('allows normal https', () => {
    expect(evaluateNavigateSafety({ url: 'https://example.com/' }).action).toBe('allow');
  });
  it('blocks dangerous downloads by default', () => {
    expect(evaluateDownloadSafety({ filename: 'setup.exe' }).action).toBe('block');
  });
});
