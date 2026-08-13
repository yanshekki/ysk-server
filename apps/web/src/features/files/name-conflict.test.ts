import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/services/api';
import {
  destKindOf,
  groupCollectedUploads,
  isNameConflictError,
  planCollectedUploads,
  resolveAppliedAction,
  rewriteTopLevelPath,
  type ConflictDecision,
  type FileNameConflictPrompt,
} from './name-conflict';
import type { CollectedUpload } from './drop-collect';

function file(rel: string): CollectedUpload {
  return { relativePath: rel, folderLabel: rel.includes('/') ? rel.split('/')[0]! : '', kind: 'file' };
}

function dir(rel: string): CollectedUpload {
  return { relativePath: rel, folderLabel: rel.split('/')[0] ?? rel, kind: 'dir' };
}

describe('groupCollectedUploads', () => {
  it('groups loose files and folder trees', () => {
    const groups = groupCollectedUploads([
      file('a.txt'),
      file('photos/x.jpg'),
      file('photos/y.jpg'),
      dir('empty'),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.name === 'a.txt')?.incomingType).toBe('file');
    expect(groups.find((g) => g.name === 'photos')?.incomingType).toBe('dir');
    expect(groups.find((g) => g.name === 'photos')?.items).toHaveLength(2);
  });
});

describe('rewriteTopLevelPath', () => {
  it('renames the top folder only', () => {
    expect(rewriteTopLevelPath('photos', 'photos', 'photos (1)')).toBe('photos (1)');
    expect(rewriteTopLevelPath('photos/a.jpg', 'photos', 'photos (1)')).toBe('photos (1)/a.jpg');
    expect(rewriteTopLevelPath('other', 'photos', 'photos (1)')).toBe('other');
  });
});

describe('resolveAppliedAction', () => {
  it('does not auto-merge a file conflict', () => {
    expect(resolveAppliedAction('merge', 'file', 'file')).toBeNull();
    expect(resolveAppliedAction('merge', 'dir', 'dir')).toBe('merge');
    expect(resolveAppliedAction('replace', 'file', 'file')).toBe('replace');
  });
});

describe('destKindOf', () => {
  it('maps list entries', () => {
    expect(destKindOf([{ name: 'a', type: 'dir' }], 'a')).toBe('dir');
    expect(destKindOf([{ name: 'a', type: 'file' }], 'a')).toBe('file');
    expect(destKindOf([], 'a')).toBeNull();
  });
});

describe('planCollectedUploads', () => {
  it('uploads new names without asking', async () => {
    const ask = vi.fn();
    const planned = await planCollectedUploads({
      collected: [file('new.txt')],
      destItems: [{ name: 'old.txt', type: 'file' }],
      destDir: '.',
      listDir: async () => [],
      ask,
    });
    expect(ask).not.toHaveBeenCalled();
    expect(planned[0]?.destRelativePath).toBe('new.txt');
    expect(planned[0]?.ifExists).toBe('fail');
  });

  it('keep both rewrites to name (1).ext', async () => {
    const planned = await planCollectedUploads({
      collected: [file('a.txt')],
      destItems: [{ name: 'a.txt', type: 'file' }],
      destDir: '.',
      listDir: async () => [],
      ask: async () => ({ action: 'keepBoth', applyToAll: false }),
    });
    expect(planned[0]?.destRelativePath).toBe('a (1).txt');
    expect(planned[0]?.ifExists).toBe('rename');
  });

  it('skip marks the item and apply-all skip skips the rest', async () => {
    const ask = vi.fn(async (): Promise<ConflictDecision> => ({
      action: 'skip',
      applyToAll: true,
    }));
    const planned = await planCollectedUploads({
      collected: [file('a.txt'), file('b.txt')],
      destItems: [
        { name: 'a.txt', type: 'file' },
        { name: 'b.txt', type: 'file' },
      ],
      destDir: '.',
      listDir: async () => [],
      ask,
    });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(planned.every((p) => p.skipped)).toBe(true);
  });

  it('merge lists the dest folder and asks about child files', async () => {
    const prompts: string[] = [];
    const planned = await planCollectedUploads({
      collected: [file('photos/x.jpg'), file('photos/y.jpg')],
      destItems: [{ name: 'photos', type: 'dir' }],
      destDir: '.',
      listDir: async () => [{ name: 'x.jpg', type: 'file' }],
      ask: async (p: FileNameConflictPrompt) => {
        prompts.push(`${p.name}:${p.incomingType}`);
        if (p.name === 'photos') return { action: 'merge', applyToAll: false };
        return { action: 'keepBoth', applyToAll: false };
      },
    });
    expect(prompts).toEqual(['photos:dir', 'x.jpg:file']);
    expect(planned.some((p) => p.kind === 'dir' && p.destRelativePath === 'photos')).toBe(true);
    expect(planned.find((p) => p.relativePath === 'photos/x.jpg')?.destRelativePath).toBe(
      'photos/x (1).jpg',
    );
    expect(planned.find((p) => p.relativePath === 'photos/y.jpg')?.destRelativePath).toBe(
      'photos/y.jpg',
    );
  });

  it('cancel stops remaining groups', async () => {
    const planned = await planCollectedUploads({
      collected: [file('a.txt'), file('b.txt')],
      destItems: [
        { name: 'a.txt', type: 'file' },
        { name: 'b.txt', type: 'file' },
      ],
      destDir: '.',
      listDir: async () => [],
      ask: async () => ({ action: 'cancel', applyToAll: false }),
    });
    expect(planned.every((p) => p.cancelled)).toBe(true);
  });

  it('treats 409 EEXIST as a name conflict', () => {
    expect(
      isNameConflictError(
        new ApiError('exists', { status: 409, details: { reason: 'EEXIST' } }),
      ),
    ).toBe(true);
    expect(isNameConflictError(new ApiError('nope', { status: 400 }))).toBe(false);
  });

  it('replace overwrites the existing file', async () => {
    const planned = await planCollectedUploads({
      collected: [file('a.txt')],
      destItems: [{ name: 'a.txt', type: 'file' }],
      destDir: '.',
      listDir: async () => [],
      ask: async () => ({ action: 'replace', applyToAll: false }),
    });
    expect(planned[0]?.ifExists).toBe('overwrite');
    expect(planned[0]?.destRelativePath).toBe('a.txt');
  });
});
