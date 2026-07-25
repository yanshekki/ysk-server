import { describe, expect, it } from 'vitest';
import { assertGitUrl } from './git-deploy.js';
import { YskError } from '@ysk/shared';

describe('assertGitUrl', () => {
  it('accepts https and git@ urls', () => {
    expect(() => assertGitUrl('https://github.com/org/repo.git')).not.toThrow();
    expect(() => assertGitUrl('git@github.com:org/repo.git')).not.toThrow();
  });
  it('rejects empty and path traversal', () => {
    expect(() => assertGitUrl('')).toThrow(YskError);
    expect(() => assertGitUrl('https://evil/../x')).toThrow(YskError);
  });
});
