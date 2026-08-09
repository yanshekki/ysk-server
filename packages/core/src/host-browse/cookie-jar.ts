/**
 * Minimal server-side cookie jar for host-browse sessions.
 * Never written to the operator browser for target domains.
 */

export type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires?: number; // epoch ms
};

function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  let d = domain.toLowerCase().replace(/^\./, '').replace(/\.$/, '');
  if (!d) return false;
  return h === d || h.endsWith(`.${d}`);
}

function parseSetCookie(raw: string, requestHost: string, requestPath: string): StoredCookie | null {
  const parts = raw.split(';').map((p) => p.trim());
  if (!parts[0]) return null;
  const eq = parts[0].indexOf('=');
  if (eq <= 0) return null;
  const name = parts[0].slice(0, eq).trim();
  const value = parts[0].slice(eq + 1).trim();
  if (!name || /[\s;,]/.test(name)) return null;

  let domain = requestHost;
  let path = requestPath.startsWith('/') ? requestPath : '/';
  // default path = directory of request
  const slash = path.lastIndexOf('/');
  if (slash > 0) path = path.slice(0, slash + 1) || '/';
  else path = '/';

  let secure = false;
  let httpOnly = false;
  let expires: number | undefined;

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const e = p.indexOf('=');
    const k = (e >= 0 ? p.slice(0, e) : p).trim().toLowerCase();
    const v = e >= 0 ? p.slice(e + 1).trim() : '';
    if (k === 'domain' && v) domain = v.replace(/^\./, '');
    else if (k === 'path' && v.startsWith('/')) path = v;
    else if (k === 'secure') secure = true;
    else if (k === 'httponly') httpOnly = true;
    else if (k === 'max-age') {
      const n = Number(v);
      if (Number.isFinite(n)) expires = Date.now() + Math.max(0, n) * 1000;
    } else if (k === 'expires') {
      const t = Date.parse(v);
      if (Number.isFinite(t)) expires = t;
    }
  }

  return { name, value, domain, path, secure, httpOnly, expires };
}

export class CookieJar {
  private cookies: StoredCookie[] = [];

  get size(): number {
    this.purgeExpired();
    return this.cookies.length;
  }

  clear(): void {
    this.cookies = [];
  }

  absorbSetCookieHeaders(
    setCookieLines: string[],
    requestUrl: URL,
  ): void {
    const host = requestUrl.hostname;
    const path = requestUrl.pathname || '/';
    for (const line of setCookieLines) {
      const c = parseSetCookie(line, host, path);
      if (!c) continue;
      // Domain must be related to request host
      if (!hostMatchesDomain(host, c.domain) && c.domain !== host) {
        // if Set-Cookie Domain is broader, still require request host under it
        if (!hostMatchesDomain(host, c.domain)) continue;
      }
      this.upsert(c);
    }
  }

  /** Absorb from Fetch Headers (getSetCookie if available). */
  absorbFromResponseHeaders(headers: Headers, requestUrl: URL): void {
    const lines =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : (() => {
            const single = headers.get('set-cookie');
            return single ? [single] : [];
          })();
    this.absorbSetCookieHeaders(lines, requestUrl);
  }

  cookieHeaderFor(url: URL): string {
    this.purgeExpired();
    const host = url.hostname;
    const path = url.pathname || '/';
    const secure = url.protocol === 'https:';
    const matched = this.cookies.filter((c) => {
      if (c.secure && !secure) return false;
      if (!hostMatchesDomain(host, c.domain)) return false;
      if (!path.startsWith(c.path)) return false;
      return true;
    });
    // sort by path length (more specific first) — RFC-ish
    matched.sort((a, b) => b.path.length - a.path.length);
    return matched.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  private upsert(c: StoredCookie): void {
    this.cookies = this.cookies.filter(
      (x) =>
        !(
          x.name === c.name &&
          x.domain === c.domain &&
          x.path === c.path
        ),
    );
    if (c.expires != null && c.expires <= Date.now()) return;
    this.cookies.push(c);
  }

  private purgeExpired(): void {
    const now = Date.now();
    this.cookies = this.cookies.filter((c) => c.expires == null || c.expires > now);
  }
}
