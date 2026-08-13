import { describe, expect, it } from 'vitest';
import {
  parseDirIfExists,
  parseFileIfExists,
  splitFileStemExt,
  uniqueFileName,
} from './files.js';

describe('uniqueFileName', () => {
  it('returns the original name when free', () => {
    expect(uniqueFileName('a.txt', [])).toBe('a.txt');
    expect(uniqueFileName('a.txt', new Set(['b.txt']))).toBe('a.txt');
  });

  it('inserts (n) before the last extension', () => {
    expect(uniqueFileName('photo.jpg', ['photo.jpg'])).toBe('photo (1).jpg');
    expect(uniqueFileName('photo.jpg', ['photo.jpg', 'photo (1).jpg'])).toBe('photo (2).jpg');
    expect(uniqueFileName('file.tar.gz', ['file.tar.gz'])).toBe('file.tar (1).gz');
  });

  it('keeps folder names and dotfiles intact as the stem', () => {
    expect(uniqueFileName('photos', ['photos'], { kind: 'dir' })).toBe('photos (1)');
    expect(uniqueFileName('my.photos', ['my.photos'], { kind: 'dir' })).toBe('my.photos (1)');
    expect(uniqueFileName('.gitignore', ['.gitignore'])).toBe('.gitignore (1)');
  });
});

describe('splitFileStemExt', () => {
  it('splits on the last dot except leading-dot names', () => {
    expect(splitFileStemExt('a.txt')).toEqual({ stem: 'a', ext: '.txt' });
    expect(splitFileStemExt('noext')).toEqual({ stem: 'noext', ext: '' });
    expect(splitFileStemExt('.env')).toEqual({ stem: '.env', ext: '' });
  });
});

describe('parse ifExists', () => {
  it('accepts known values and falls back otherwise', () => {
    expect(parseFileIfExists('rename', 'fail')).toBe('rename');
    expect(parseFileIfExists('nope', 'overwrite')).toBe('overwrite');
    expect(parseDirIfExists('fail')).toBe('fail');
    expect(parseDirIfExists('overwrite')).toBe('overwrite');
    expect(parseDirIfExists(undefined)).toBe('merge');
  });
});
