import { describe, expect, it } from 'vitest';
import {
  applyEditorTab,
  countLines,
  cursorFromOffset,
  editorLanguageLabel,
  gutterLabels,
} from './code-editor-model';

describe('code-editor-model', () => {
  it('maps compose filenames to YAML', () => {
    expect(editorLanguageLabel('compose.yml')).toBe('YAML');
    expect(editorLanguageLabel('a.yaml')).toBe('YAML');
    expect(editorLanguageLabel('index.html')).toBe('HTML');
  });

  it('counts lines and gutter labels', () => {
    expect(countLines('')).toBe(1);
    expect(countLines('a\nb\nc')).toBe(3);
    expect(gutterLabels(3)).toBe('1\n2\n3\n');
  });

  it('maps cursor offset to ln/col', () => {
    expect(cursorFromOffset('ab\ncd', 0)).toEqual({ line: 1, col: 1 });
    expect(cursorFromOffset('ab\ncd', 3)).toEqual({ line: 2, col: 1 });
  });

  it('Tab inserts two spaces; Shift+Tab unindents', () => {
    expect(applyEditorTab('ab', 1, 1, false)).toEqual({
      text: 'a  b',
      start: 3,
      end: 3,
    });
    expect(applyEditorTab('  key:', 0, 0, true).text).toBe('key:');
    const block = applyEditorTab('a\nb', 0, 3, false);
    expect(block.text).toBe('  a\n  b');
  });
});
