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

/**
 * Render an Nginx server block for reverse proxy.
 */
export function renderNginxProxy(config: NginxProxyConfig): string {
  if (!config.serverName || !config.upstream) {
    throw new YskError(ErrorCodes.VALIDATION, 'serverName and upstream are required', {
      httpStatus: 400,
    });
  }
  const listen = config.ssl
    ? 'listen 443 ssl http2;\n  listen 80;\n  # prefer HTTPS when certs present'
    : 'listen 80;';
  const cert =
    config.sslCertificate ?? `/etc/letsencrypt/live/${config.serverName}/fullchain.pem`;
  const key =
    config.sslCertificateKey ?? `/etc/letsencrypt/live/${config.serverName}/privkey.pem`;
  const sslBlock = config.ssl
    ? `
  ssl_certificate ${cert};
  ssl_certificate_key ${key};
  ssl_protocols TLSv1.2 TLSv1.3;
`.trim()
    : '';
  const realIp = config.cloudflareRealIp ? CLOUDFLARE_REAL_IP : '';
  return `server {
  ${listen}
  server_name ${config.serverName};
  ${sslBlock}
  ${realIp}

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
}): string {
  if (!opts.serverName || !opts.docRoot) {
    throw new YskError(ErrorCodes.VALIDATION, 'serverName and docRoot required', {
      httpStatus: 400,
    });
  }
  const listen = opts.ssl
    ? 'listen 443 ssl http2;\n  listen 80;'
    : 'listen 80;';
  const cert =
    opts.sslCertificate ?? `/etc/letsencrypt/live/${opts.serverName}/fullchain.pem`;
  const key =
    opts.sslCertificateKey ?? `/etc/letsencrypt/live/${opts.serverName}/privkey.pem`;
  const sslBlock = opts.ssl
    ? `
  ssl_certificate ${cert};
  ssl_certificate_key ${key};
  ssl_protocols TLSv1.2 TLSv1.3;
`.trim()
    : '';
  const realIp = opts.cloudflareRealIp ? CLOUDFLARE_REAL_IP : '';
  return `server {
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
}): string {
  if (!opts.serverName || !opts.docRoot || !opts.fpmSocket) {
    throw new YskError(ErrorCodes.VALIDATION, 'serverName, docRoot, fpmSocket required', {
      httpStatus: 400,
    });
  }
  const listen = opts.ssl
    ? 'listen 443 ssl http2;\n  listen 80;'
    : 'listen 80;';
  const cert =
    opts.sslCertificate ?? `/etc/letsencrypt/live/${opts.serverName}/fullchain.pem`;
  const key =
    opts.sslCertificateKey ?? `/etc/letsencrypt/live/${opts.serverName}/privkey.pem`;
  const sslBlock = opts.ssl
    ? `
  ssl_certificate ${cert};
  ssl_certificate_key ${key};
  ssl_protocols TLSv1.2 TLSv1.3;
`.trim()
    : '';
  const realIp = opts.cloudflareRealIp ? CLOUDFLARE_REAL_IP : '';
  return `server {
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
