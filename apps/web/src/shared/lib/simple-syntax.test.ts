import { describe, expect, it } from 'vitest';
import {
  highlightToHtml,
  syntaxLangFromName,
  tokenize,
} from './simple-syntax';

describe('simple-syntax', () => {
  it('maps extensions to languages', () => {
    expect(syntaxLangFromName('index.php')).toBe('php');
    expect(syntaxLangFromName('a.ts')).toBe('ts');
    expect(syntaxLangFromName('x.unknown')).toBe('plain');
  });

  it('colors PHP keywords, strings, variables', () => {
    const html = highlightToHtml('<?php echo "YSK"; $x = 1;', 'php');
    expect(html).toContain('tok-keyword');
    expect(html).toContain('tok-string');
    expect(html).toContain('tok-variable');
    expect(html).toContain('tok-number');
    expect(html).toContain('&lt;?php');
  });

  it('marks function names after function keyword and call sites', () => {
    const toks = tokenize('function hello() { foo(); }', 'js');
    const fns = toks.filter((t) => t.cls === 'function').map((t) => t.text);
    expect(fns).toContain('hello');
    expect(fns).toContain('foo');
  });

  it('marks class names', () => {
    const toks = tokenize('class User extends Base {}', 'js');
    expect(toks.some((t) => t.cls === 'class' && t.text === 'User')).toBe(true);
    expect(toks.some((t) => t.cls === 'class' && t.text === 'Base')).toBe(true);
  });

  it('escapes HTML in plain text', () => {
    const html = highlightToHtml('<script>', 'plain');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
