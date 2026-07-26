/**
 * Nginx reverse proxy + Let’s Encrypt SSL config generation.
 */

import type { NginxProxyConfig, SslCertPlan } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';

const CLOUDFLARE_REAL_IP = `
# Cloudflare real IP
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
real_ip_header CF-Connecting-IP;
`.trim();

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

function httpRedirectBlock(serverName: string): string {
  return `server {
  listen 80;
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
    throw new YskError(ErrorCodes.VALIDATION, 'serverName and upstream are required', {
      httpStatus: 400,
    });
  }
  const realIp = config.cloudflareRealIp ? CLOUDFLARE_REAL_IP : '';
  const force = Boolean(config.ssl && config.forceHttps);
  const sslBlock = sslLines({
    ssl: config.ssl,
    sslCertificate: config.sslCertificate,
    sslCertificateKey: config.sslCertificateKey,
    serverName: config.serverName,
    hsts: config.hsts,
  });

  const auth =
    config.authBasicUserFile
      ? `
  auth_basic "${config.authBasicRealm ?? 'Restricted'}";
  auth_basic_user_file ${config.authBasicUserFile};
`
      : '';

  if (config.siteRedirectUrl) {
    const target = config.siteRedirectUrl.replace(/"/g, '');
    const listen = config.ssl ? 'listen 443 ssl http2;\n  listen 80;' : 'listen 80;';
    return `server {
  ${listen}
  server_name ${config.serverName};
  ${sslBlock}
  return 301 ${target}$request_uri;
}
`;
  }

  if (force) {
    return `${httpRedirectBlock(config.serverName)}server {
  listen 443 ssl http2;
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

  const listen = config.ssl
    ? 'listen 443 ssl http2;\n  listen 80;'
    : 'listen 80;';
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
export function renderNginxStatic(opts: {
  serverName: string;
  docRoot: string;
  ssl?: boolean;
  cloudflareRealIp?: boolean;
  sslCertificate?: string;
  sslCertificateKey?: string;
  forceHttps?: boolean;
  hsts?: boolean;
}): string {
  if (!opts.serverName || !opts.docRoot) {
    throw new YskError(ErrorCodes.VALIDATION, 'serverName and docRoot required', {
      httpStatus: 400,
    });
  }
  const realIp = opts.cloudflareRealIp ? CLOUDFLARE_REAL_IP : '';
  const force = Boolean(opts.ssl && opts.forceHttps);
  const sslBlock = sslLines({
    ssl: opts.ssl,
    sslCertificate: opts.sslCertificate,
    sslCertificateKey: opts.sslCertificateKey,
    serverName: opts.serverName,
    hsts: opts.hsts,
  });

  const body = (listen: string) => `server {
  ${listen}
  server_name ${opts.serverName};
  root ${opts.docRoot};
  index index.html index.htm;
  ${sslBlock}
  ${realIp}

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~ /\\. {
    deny all;
  }

  location ~* \\.(css|js|jpg|jpeg|png|gif|ico|svg|woff2?)$ {
    expires 7d;
    add_header Cache-Control "public";
    try_files $uri =404;
  }
}
`;

  if (force) {
    return `${httpRedirectBlock(opts.serverName)}${body('listen 443 ssl http2;')}`;
  }
  const listen = opts.ssl ? 'listen 443 ssl http2;\n  listen 80;' : 'listen 80;';
  return body(listen);
}

/**
 * Render Nginx server block for PHP-FPM (unix socket) + static docroot.
 */
export function renderNginxPhpFpm(opts: {
  serverName: string;
  docRoot: string;
  /** e.g. /run/php/php8.2-fpm-ysk_demo.sock */
  fpmSocket: string;
  ssl?: boolean;
  cloudflareRealIp?: boolean;
  sslCertificate?: string;
  sslCertificateKey?: string;
  forceHttps?: boolean;
  hsts?: boolean;
}): string {
  if (!opts.serverName || !opts.docRoot || !opts.fpmSocket) {
    throw new YskError(ErrorCodes.VALIDATION, 'serverName, docRoot, fpmSocket required', {
      httpStatus: 400,
    });
  }
  const realIp = opts.cloudflareRealIp ? CLOUDFLARE_REAL_IP : '';
  const force = Boolean(opts.ssl && opts.forceHttps);
  const sslBlock = sslLines({
    ssl: opts.ssl,
    sslCertificate: opts.sslCertificate,
    sslCertificateKey: opts.sslCertificateKey,
    serverName: opts.serverName,
    hsts: opts.hsts,
  });

  const body = (listen: string) => `server {
  ${listen}
  server_name ${opts.serverName};
  root ${opts.docRoot};
  index index.php index.html;
  ${sslBlock}
  ${realIp}

  location / {
    try_files $uri $uri/ /index.php?$query_string;
  }

  location ~ \\.php$ {
    include snippets/fastcgi-php.conf;
    fastcgi_pass unix:${opts.fpmSocket};
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    include fastcgi_params;
  }

  location ~ /\\. {
    deny all;
  }
}
`;

  if (force) {
    return `${httpRedirectBlock(opts.serverName)}${body('listen 443 ssl http2;')}`;
  }
  const listen = opts.ssl ? 'listen 443 ssl http2;\n  listen 80;' : 'listen 80;';
  return body(listen);
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
    throw new YskError(ErrorCodes.VALIDATION, 'domain and email required for SSL', {
      httpStatus: 400,
    });
  }
  if (plan.provider === 'upload') {
    return {
      commands: [],
      notes: ['User-uploaded certificate path; place files under /etc/ysk-server/certs'],
    };
  }
  const challenge =
    plan.challenge === 'dns-01'
      ? `certbot certonly --manual --preferred-challenges dns -d ${plan.domain} --email ${plan.email} --agree-tos --non-interactive`
      : `certbot --nginx -d ${plan.domain} --email ${plan.email} --agree-tos --non-interactive --redirect`;
  return {
    commands: [challenge, 'systemctl reload nginx'],
    notes: [
      'Requires root and port 80/443 reachable for http-01',
      'Renewal via certbot.timer',
    ],
  };
}
