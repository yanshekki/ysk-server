/**
 * HTML rewrite so navigations and subresources go through host-browse proxy.
 * Forms POST → formUrl (contentToken auth); GET resources → proxyUrl.
 */

const SKIP_SCHEMES = /^(javascript:|data:|mailto:|tel:|blob:|#)/i;

export type RewriteHtmlOpts = {
  pageUrl: string;
  /** GET content/asset proxy */
  proxyUrl: (absoluteTarget: string) => string;
  /** POST form endpoint (contentToken) */
  formUrl?: (absoluteTarget: string) => string;
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
  const re = new RegExp(`(\\s${attr}\\s*=\\s*)(["'])([^"']*)(["'])`, 'gi');
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

/** Rewrite <form ...> action for GET→content, POST→form endpoint. */
function rewriteForms(
  html: string,
  pageUrl: string,
  proxyUrl: (abs: string) => string,
  formUrl?: (abs: string) => string,
): string {
  return html.replace(/<form\b([^>]*)>/gi, (_full, attrs: string) => {
    const methodM = attrs.match(/\smethod\s*=\s*(["']?)(get|post|put|patch)\1/i);
    const method = (methodM?.[2] || 'get').toLowerCase();
    const isPost = method === 'post' || method === 'put' || method === 'patch';

    let action = pageUrl;
    const actionM = attrs.match(/\saction\s*=\s*(["'])([^"']*)\1/i);
    if (actionM) {
      const abs = resolveUrl(pageUrl, actionM[2]);
      if (abs) action = abs;
    } else {
      // default form action = current page
      action = pageUrl;
    }

    const targetFn = isPost && formUrl ? formUrl : proxyUrl;
    const proxied = targetFn(action);

    let next = attrs;
    if (actionM) {
      next = next.replace(
        /\saction\s*=\s*(["'])([^"']*)\1/i,
        ` action="${proxied}"`,
      );
    } else {
      next = `${next} action="${proxied}"`;
    }
    // Ensure POST methods stay POST for form endpoint
    if (isPost && formUrl && !methodM) {
      next = `${next} method="post"`;
    }
    return `<form${next}>`;
  });
}

/**
 * Rewrite HTML attributes + forms. Strips meta CSP that blocks proxy assets.
 */
export function rewriteHtml(
  html: string,
  opts: RewriteHtmlOpts,
): { html: string; warnings: string[] } {
  const warnings: string[] = [];
  let out = html;
  const { pageUrl, proxyUrl, formUrl } = opts;

  // Forms first (action before generic attr rewrite)
  out = rewriteForms(out, pageUrl, proxyUrl, formUrl);

  // Note: form action already rewritten — do not re-proxy action= attributes
  const attrs = ['href', 'src', 'poster', 'data', 'xlink:href'];
  for (const a of attrs) {
    out = rewriteAttr(out, a, pageUrl, proxyUrl);
  }
  out = rewriteSrcset(out, pageUrl, proxyUrl);

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

  const beforeCsp = out;
  out = out.replace(
    /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,
    '',
  );
  if (out !== beforeCsp) warnings.push('stripped_meta_csp');

  // @import in style tags
  out = out.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_f, open, css, close) => `${open}${rewriteCss(css, opts)}${close}`,
  );

  warnings.push('spa_may_break');
  return { html: out, warnings };
}

export function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!m) return undefined;
  const t = m[1].replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 200) : undefined;
}

/** CSS url() + @import rewrite. */
export function rewriteCss(css: string, opts: RewriteHtmlOpts): string {
  let out = css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, _q, raw) => {
    const abs = resolveUrl(opts.pageUrl, String(raw).trim());
    if (!abs) return full;
    return `url(${opts.proxyUrl(abs)})`;
  });
  out = out.replace(
    /@import\s+(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?/gi,
    (full, _q, raw) => {
      const abs = resolveUrl(opts.pageUrl, String(raw).trim());
      if (!abs) return full;
      return `@import url(${opts.proxyUrl(abs)})`;
    },
  );
  return out;
}
