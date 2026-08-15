import { describe, expect, it } from 'vitest';
import { collectFromFileList } from './drop-collect';

describe('collectFromFileList', () => {
  it('does not treat a slash in a single file name as a folder', () => {
    const file = { name: 'qa35/slash.txt' } as File;
    const out = collectFromFileList([file]);
    expect(out).toEqual([
      { relativePath: 'slash.txt', folderLabel: '', kind: 'file', file },
    ]);
  });

  it('keeps webkitRelativePath folder trees', () => {
    const file = { name: 'a.txt', webkitRelativePath: 'folder/sub/a.txt' } as File & {
      webkitRelativePath: string;
    };
    const out = collectFromFileList([file]);
    expect(out[0]?.relativePath).toBe('folder/sub/a.txt');
    expect(out[0]?.folderLabel).toBe('folder');
  });
});
