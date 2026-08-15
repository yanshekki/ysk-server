import { describe, expect, it } from 'vitest';
import { projectGitHookAbsoluteUrl } from './git-hook-url';

describe('projectGitHookAbsoluteUrl', () => {
  it('joins origin and path', () => {
    expect(projectGitHookAbsoluteUrl('/api/v1/hooks/git/abc', 'https://panel.example:9287')).toBe(
      'https://panel.example:9287/api/v1/hooks/git/abc',
    );
  });

  it('keeps an absolute URL and ignores empty path', () => {
    expect(projectGitHookAbsoluteUrl('https://x/h', 'https://other')).toBe('https://x/h');
    expect(projectGitHookAbsoluteUrl('', 'https://x')).toBe('');
    expect(projectGitHookAbsoluteUrl('hooks/git/x', 'https://h')).toBe('https://h/hooks/git/x');
  });
});
