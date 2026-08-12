/**
 * Nginx reverse proxy + Let’s Encrypt SSL config generation.
 */

import type { NginxProxyConfig, SslCertPlan } from '@ysk-server/shared';
import { ErrorCodes, YskError, tl } from '@ysk-server/shared';
import {
  renderNginxRealIpBlock,
  type RealIpHostConfig,
  type RealIpProviderId,
} from './real-ip/index.js';

/** Options for multi-CDN real client IP (see hosting/real-ip). */
export type NginxRealIpOpts = {
  /** @deprecated use realIpProvider; true → cloudflare when host default is none */
  cloudflareRealIp?: boolean;
  realIpProvider?: RealIpProviderId | 'inherit';
  realIpHost?: RealIpHostConfig;
};

function realIpSnippet(opts: NginxRealIpOpts): string {
  return renderNginxRealIpBlock({
    provider: opts.realIpProvider,
    host: opts.realIpHost,
    cloudflareRealIp: opts.cloudflareRealIp,
  });
}

/** Build space-separated server_name from primary + aliases. */
export function buildServerNameList(primary?: string, aliases?: string[]): string {
  const names = [primary, ...(aliases ?? [])]
    .map((s) => (s ?? '').trim().toLowerCase())
    .filter(Boolean);
  const uniq = [...new Set(names)];
  return uniq.join(' ') || 'localhost';
}

function sslLines(opts: {
  ssl?: boolean;
  sslCertificate?: string;
  sslCertificateKey?: string;
  serverName: string;
  hsts?: boolean;
}): string {
  if (!opts.ssl) return '';
  const primary = opts.serverName.split(/\s+/)[0] || 'localhost';
  const cert = opts.sslCertificate ?? `/etc/letsencrypt/live/${primary}/fullchain.pem`;
  const key = opts.sslCertificateKey ?? `/etc/letsencrypt/live/${primary}/privkey.pem`;
  const hsts = opts.hsts
    ? '\n  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;'
    : '';
  return `
  ssl_certificate ${cert};
  ssl_certificate_key ${key};
  ssl_protocols TLSv1.2 TLSv1.3;${hsts}
`.trim();
}

/** listen directives with optional bind IP (dual-stack when unbound). */
export function nginxListenLines(opts: {
  ssl?: boolean;
  bindIp?: string;
}): string {
  const ip = opts.bindIp?.trim();
  if (ip) {
    // IPv6 literal needs brackets: [2001:db8::1]:80
    const isV6 = ip.includes(':') && !ip.startsWith('[');
    const host = isV6 ? `[${ip}]` : ip;
    const prefix = `${host}:`;
    if (opts.ssl) {
      return `listen ${prefix}443 ssl http2;\n  listen ${prefix}80;`;
    }
    return `listen ${prefix}80;`;
  }
  // Dual-stack public listeners (IPv4 + IPv6)
  if (opts.ssl) {
    return [
      'listen 443 ssl http2;',
      'listen [::]:443 ssl http2;',
      'listen 80;',
      'listen [::]:80;',
    ].join('\n  ');
  }
  return 'listen 80;\n  listen [::]:80;';
}

function httpRedirectBlock(serverName: string, bindIp?: string): string {
  const listen = nginxListenLines({ ssl: false, bindIp });
  return `server {
  ${listen}
  server_name ${serverName};
  return 301 https://$host$request_uri;
}
`;
}

/**
 * Render an Nginx server block for reverse proxy.
 */
export function renderNginxProxy(config: NginxProxyConfig): string {
  if (!config.serverName || !config.upstream) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1388'), {
      httpStatus: 400,
    });
  }
  const realIp = realIpSnippet({
    cloudflareRealIp: config.cloudflareRealIp,
    realIpProvider: (config as NginxProxyConfig & NginxRealIpOpts).realIpProvider,
    realIpHost: (config as NginxProxyConfig & NginxRealIpOpts).realIpHost,
  });
  const force = Boolean(config.ssl && config.forceHttps);
  const sslBlock = sslLines({
    ssl: config.ssl,
    sslCertificate: config.sslCertificate,
    sslCertificateKey: config.sslCertificateKey,
    serverName: config.serverName,
    hsts: config.hsts,
  });
  const bindIp = config.bindIp;

  const auth = authBasicBlock(config);

  if (config.siteRedirectUrl?.trim()) {
    return siteRedirectOnly({
      serverName: config.serverName,
      siteRedirectUrl: config.siteRedirectUrl.trim(),
      ssl: config.ssl,
      sslCertificate: config.sslCertificate,
      sslCertificateKey: config.sslCertificateKey,
      hsts: config.hsts,
      bindIp,
    });
  }

  if (force) {
    const sslListen = nginxListenLines({ ssl: true, bindIp }).split('\n')[0];
    return `${httpRedirectBlock(config.serverName, bindIp)}server {
  ${sslListen}
  server_name ${config.serverName};
  ${sslBlock}
  ${realIp}
  ${auth}

  location / {
    proxy_pass ${config.upstream};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
`;
  }

  const listen = nginxListenLines({ ssl: config.ssl, bindIp });
  return `server {
  ${listen}
  server_name ${config.serverName};
  ${sslBlock}
  ${realIp}
  ${auth}

  location / {
    proxy_pass ${config.upstream};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
`;
}

/**
 * Render Nginx server block for pure static site (root + try_files).
 */
function authBasicBlock(opts: {
  authBasicUserFile?: string;
  authBasicRealm?: string;
}): string {
  if (!opts.authBasicUserFile) return '';
  return `
  auth_basic "${opts.authBasicRealm ?? 'Restricted'}";
  auth_basic_user_file ${opts.authBasicUserFile};
`;
}

function siteRedirectOnly(opts: {
  serverName: string;
  siteRedirectUrl: string;
  ssl?: boolean;
  sslCertificate?: string;
  sslCertificateKey?: string;
  hsts?: boolean;
  bindIp?: string;
}): string {
  const target = opts.siteRedirectUrl.replace(/"/g, '');
  const listen = nginxListenLines({ ssl: opts.ssl, bindIp: opts.bindIp });
  const sslBlock = sslLines({
    ssl: opts.ssl,
    sslCertificate: opts.sslCertificate,
    sslCertificateKey: opts.sslCertificateKey,
    serverName: opts.serverName,
    hsts: opts.hsts,
  });
  return `server {
  ${listen}
  server_name ${opts.serverName};
  ${sslBlock}
  return 301 ${target}$request_uri;
}
`;
}

export function renderNginxStatic(
  opts: {
    serverName: string;
    docRoot: string;
    ssl?: boolean;
    cloudflareRealIp?: boolean;
    sslCertificate?: string;
    sslCertificateKey?: string;
    forceHttps?: boolean;
    hsts?: boolean;
    siteRedirectUrl?: string;
    authBasicUserFile?: string;
    authBasicRealm?: string;
    bindIp?: string;
    /** Static asset cache max-age (default 7d) */
    staticCache?: boolean;
  } & NginxRealIpOpts,
): string {
  if (!opts.serverName || !opts.docRoot) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1389'), {
      httpStatus: 400,
    });
  }
  if (opts.siteRedirectUrl?.trim()) {
    return siteRedirectOnly({
      serverName: opts.serverName,
      siteRedirectUrl: opts.siteRedirectUrl.trim(),
      ssl: opts.ssl,
      sslCertificate: opts.sslCertificate,
      sslCertificateKey: opts.sslCertificateKey,
      hsts: opts.hsts,
      bindIp: opts.bindIp,
    });
  }
  const realIp = realIpSnippet(opts);
  const force = Boolean(opts.ssl && opts.forceHttps);
  const sslBlock = sslLines({
    ssl: opts.ssl,
    sslCertificate: opts.sslCertificate,
    sslCertificateKey: opts.sslCertificateKey,
    serverName: opts.serverName,
    hsts: opts.hsts,
  });
  const auth = authBasicBlock(opts);
  const assetCache = opts.staticCache !== false;

  const body = (listen: string) => `server {
  ${listen}
  server_name ${opts.serverName};
  root ${opts.docRoot};
  index index.html index.htm;
  ${sslBlock}
  ${realIp}
  ${auth}

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~ /\\. {
    deny all;
  }

  location ~* \\.(css|js|jpg|jpeg|png|gif|ico|svg|woff2?)$ {
    ${assetCache ? 'expires 7d;\n    add_header Cache-Control "public";' : 'expires off;'}
    try_files $uri =404;
  }
}
`;

  if (force) {
    const sslListen = nginxListenLines({ ssl: true, bindIp: opts.bindIp }).split('\n')[0];
    return `${httpRedirectBlock(opts.serverName, opts.bindIp)}${body(sslListen)}`;
  }
  const listen = nginxListenLines({ ssl: opts.ssl, bindIp: opts.bindIp });
  return body(listen);
}

/**
 * Render Nginx server block for PHP projects.
 * Topology (required): Internet → Nginx → Apache backend → PHP-FPM.
 * Does NOT fastcgi directly to FPM — Apache owns DocumentRoot + .php handler.
 */
export function renderNginxPhpFpm(
  opts: {
    serverName: string;
    /** Docroot is served by Apache; kept for API/compat (optional notes). */
    docRoot?: string;
    /** @deprecated Nginx no longer fastcgi to FPM; Apache uses the pool sock. */
    fpmSocket?: string;
    /** e.g. http://127.0.0.1:8080 — default from YSK_APACHE_BACKEND_* */
    apacheUpstream?: string;
    ssl?: boolean;
    cloudflareRealIp?: boolean;
    sslCertificate?: string;
    sslCertificateKey?: string;
    forceHttps?: boolean;
    hsts?: boolean;
    siteRedirectUrl?: string;
    authBasicUserFile?: string;
    authBasicRealm?: string;
    bindIp?: string;
  } & NginxRealIpOpts,
): string {
  if (!opts.serverName) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1390'), {
      httpStatus: 400,
    });
  }
  const upstream =
    (opts.apacheUpstream || '').trim() ||
    // lazy import-free default matching runtime.apacheBackendUpstream()
    `http://${process.env.YSK_APACHE_BACKEND_BIND || '127.0.0.1'}:${process.env.YSK_APACHE_BACKEND_PORT || '8080'}`;

  // Reuse proxy renderer — PHP front is reverse-proxy to Apache
  return renderNginxProxy({
    serverName: opts.serverName,
    upstream,
    ssl: Boolean(opts.ssl),
    cloudflareRealIp: Boolean(opts.cloudflareRealIp),
    sslCertificate: opts.sslCertificate,
    sslCertificateKey: opts.sslCertificateKey,
    forceHttps: opts.forceHttps,
    hsts: opts.hsts,
    siteRedirectUrl: opts.siteRedirectUrl,
    authBasicUserFile: opts.authBasicUserFile,
    authBasicRealm: opts.authBasicRealm,
    bindIp: opts.bindIp,
    realIpProvider: opts.realIpProvider,
    realIpHost: opts.realIpHost,
  } as NginxProxyConfig & NginxRealIpOpts);
}

/**
 * Best-effort purge of common nginx cache dirs + reload.
 * Honest: needs EXECUTE; may no-op if dirs empty.
 */
export async function purgeNginxCache(input: {
  host: import('../host/executor.js').HostExecutor;
}): Promise<{ ok: boolean; notes: string[]; blocked?: boolean }> {
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      notes: [tl('notes.auto.n1131')],
    };
  }
  const r = await input.host.runCommand(
    [
      'bash',
      '-c',
      'rm -rf /var/cache/nginx/* /var/lib/nginx/cache/* /var/cache/nginx/proxy_temp/* 2>/dev/null; nginx -t 2>&1 && systemctl reload nginx 2>&1; echo EXIT:$?',
    ],
    { timeoutMs: 30_000 },
  );
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const ok = r.exitCode === 0 && !/nginx: configuration file .+ test failed/i.test(out);
  return {
    ok,
    notes: [
      ok
        ? tl('notes.auto.n0751')
        : tl('notes.auto.t0109', { v0: (out.slice(0, 400)) }),
      tl('notes.auto.n1207') + (ok ? 'applied（best-effort）' : 'failed'),
    ],
  };
}

/** Suspended site: refuse traffic with 503. */
export function renderNginxSuspended(serverName: string): string {
  return `server {
  listen 80;
  server_name ${serverName};
  return 503;
}
`;
}

/**
 * Build certbot command plan for Let’s Encrypt.
 */
export function planLetsEncrypt(plan: SslCertPlan): { commands: string[]; notes: string[] } {
  if (!plan.domain || !plan.email) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1249'), {
      httpStatus: 400,
    });
  }
  if (plan.provider === 'upload') {
    return {
      commands: [],
      notes: [tl('notes.auto.n0792')],
    };
  }
  const isWildcard = plan.domain.startsWith('*.');
  const useDns01 = plan.challenge === 'dns-01' || isWildcard;
  // Wildcard requires dns-01; include apex + wildcard when operator requests *.example.com
  const names = isWildcard
    ? [`-d ${plan.domain.slice(2)} -d ${plan.domain}`]
    : [`-d ${plan.domain}`];
  const challenge = useDns01
    ? `certbot certonly --manual --preferred-challenges dns ${names.join(' ')} --email ${plan.email} --agree-tos --non-interactive`
    : `certbot --nginx -d ${plan.domain} --email ${plan.email} --agree-tos --non-interactive --redirect`;
  return {
    commands: useDns01 ? [challenge] : [challenge, 'systemctl reload nginx'],
    notes: useDns01
      ? [
          tl('notes.auto.n0208'),
          tl('notes.auto.n1217'),
          tl('notes.auto.n0177'),
        ]
      : [
          'Requires root and port 80/443 reachable for http-01',
          'Renewal via certbot.timer',
        ],
  };
}
