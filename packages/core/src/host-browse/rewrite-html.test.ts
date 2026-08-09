import { describe, expect, it } from 'vitest';
import { extractTitle, rewriteCss, rewriteHtml } from './rewrite-html.js';

describe('host-browse rewrite', () => {
  const proxyUrl = (abs: string) => `/proxy?u=${encodeURIComponent(abs)}`;

  it('rewrites href and src to proxy', () => {
    const html = `<a href="/x">x</a><img src="https://cdn.example/a.png">`;
    const { html: out } = rewriteHtml(html, {
      pageUrl: 'https://example.com/page',
      proxyUrl,
    });
    expect(out).toContain('/proxy?u=');
    expect(out).toContain(encodeURIComponent('https://example.com/x'));
    expect(out).toContain(encodeURIComponent('https://cdn.example/a.png'));
  });

  it('skips javascript and data urls', () => {
    const html = `<a href="javascript:alert(1)">x</a><img src="data:image/png;base64,xx">`;
    const { html: out } = rewriteHtml(html, {
      pageUrl: 'https://example.com/',
      proxyUrl,
    });
    expect(out).toContain('javascript:alert(1)');
    expect(out).toContain('data:image/png');
  });

  it('extracts title', () => {
    expect(extractTitle('<html><title> Hello </title></html>')).toBe('Hello');
  });

  it('rewrites css url()', () => {
    const css = `body{background:url("/bg.png")}`;
    const out = rewriteCss(css, {
      pageUrl: 'https://example.com/',
      proxyUrl,
    });
    expect(out).toContain('/proxy?u=');
  });
});
