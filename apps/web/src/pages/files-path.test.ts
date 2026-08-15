import { describe, expect, it } from 'vitest';
import { pathCrumbs, sanitizeFilesQueryPath } from './FilesPage';

describe('files query path', () => {
  it('sanitizes ?path= and builds crumbs', () => {
    expect(sanitizeFilesQueryPath(null)).toBe('.');
    expect(sanitizeFilesQueryPath('../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeFilesQueryPath('/app/src')).toBe('app/src');
    expect(pathCrumbs('app')).toEqual(['app']);
    expect(pathCrumbs('.')).toEqual([]);
  });
});
