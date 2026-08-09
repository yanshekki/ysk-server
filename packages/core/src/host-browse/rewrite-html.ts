/**
 * HTML rewrite so navigations and subresources go through host-browse proxy.
 */

const SKIP_SCHEMES = /^(javascript:|data:|mailto:|tel:|blob:|#)/i;

export type RewriteHtmlOpts = {
  /** Absolute page URL after redirects */
  pageUrl: string;
  /**
   * Build proxied content/asset URL for an absolute target URL.
   * e.g. (abs) => `/api/v1/host-browse/sessions/SID/content?u=...&ct=...`
   */
  proxyUrl: (absoluteTarget: string) => string;
};

function resolveUrl(base: string, href: string): string | null {
  const h = href.trim();
  if (!h || SKIP_SCHEMES.test(h)) return null;
  try {
    return new URL(h, base).href;
  } catch {
    return null;
  }
}

function rewriteAttr(
  html: string,
  attr: string,
  pageUrl: string,
  proxyUrl: (abs: string) => string,
): string {
  // attr="..." or attr='...'
  const re = new RegExp(
    `(\\s${attr}\\s*=\\s*)(["'])([^"']*)(["'])`,
    'gi',
  );
  return html.replace(re, (full, pre, q1, val, q2) => {
    const abs = resolveUrl(pageUrl, val);
    if (!abs) return full;
    return `${pre}${q1}${proxyUrl(abs)}${q2}`;
  });
}

function rewriteSrcset(
  html: string,
  pageUrl: string,
  proxyUrl: (abs: string) => string,
): string {
  const re = /(\ssrcset\s*=\s*)(["'])([^"']*)(["'])/gi;
  return html.replace(re, (_full, pre, q1, val, q2) => {
    const parts = String(val)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const out = parts.map((part) => {
      const bits = part.split(/\s+/);
      const u = bits[0];
      const rest = bits.slice(1).join(' ');
      const abs = resolveUrl(pageUrl, u);
      if (!abs) return part;
      return rest ? `${proxyUrl(abs)} ${rest}` : proxyUrl(abs);
    });
    return `${pre}${q1}${out.join(', ')}${q2}`;
  });
}

/**
 * Inject <base> is risky with sandbox; we rewrite common attrs instead.
 * Also rewrite meta refresh URLs.
 */
export function rewriteHtml(html: string, opts: RewriteHtmlOpts): {
  html: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  let out = html;
  const { pageUrl, proxyUrl } = opts;

  const attrs = [
    'href',
    'src',
    'action',
    'poster',
    'data',
    'xlink:href',
  ];
  for (const a of attrs) {
    out = rewriteAttr(out, a, pageUrl, proxyUrl);
  }
  out = rewriteSrcset(out, pageUrl, proxyUrl);

  // meta refresh
  out = out.replace(
    /(<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'])([^"']*)(["'])/gi,
    (full, pre, content, post) => {
      const m = String(content).match(/^(\s*\d+\s*;\s*url\s*=\s*)(.+)$/i);
      if (!m) return full;
      const abs = resolveUrl(pageUrl, m[2].trim());
      if (!abs) return full;
      return `${pre}${m[1]}${proxyUrl(abs)}${post}`;
    },
  );

  // Strip CSP meta that would break proxy (honest note)
  const beforeCsp = out;
  out = out.replace(
    /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,
    '',
  );
  if (out !== beforeCsp) {
    warnings.push('stripped_meta_csp');
  }

  // Block service worker registration is not possible via static rewrite alone
  warnings.push('spa_may_break');

  return { html: out, warnings };
}

/** Extract <title> text if present. */
export function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!m) return undefined;
  const t = m[1].replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 200) : undefined;
}

/** Basic CSS url(...) rewrite. */
export function rewriteCss(css: string, opts: RewriteHtmlOpts): string {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, _q, raw) => {
    const abs = resolveUrl(opts.pageUrl, String(raw).trim());
    if (!abs) return full;
    return `url(${opts.proxyUrl(abs)})`;
  });
}
