/**
 * Render Apache vhost conf for managed sites.
 */

import type { ApacheSiteKind } from './types.js';

export function renderApacheSite(opts: {
  serverName: string;
  kind: ApacheSiteKind;
  upstream?: string;
  root?: string;
  ssl?: boolean;
  forceHttps?: boolean;
  hsts?: boolean;
  clientMaxBody?: string;
  indexes?: boolean;
  fpmSocket?: string;
}): string {
  const name = opts.serverName.trim() || 'localhost';
  const body =
    opts.clientMaxBody && opts.clientMaxBody !== 'inherit'
      ? `  LimitRequestBody ${parseBodyBytes(opts.clientMaxBody)}\n`
      : '';
  const indexes = opts.indexes ? 'Indexes' : '-Indexes';
  const hsts = opts.ssl && opts.hsts
    ? '  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"\n'
    : '';

  let core = '';
  if (opts.kind === 'static') {
    const root = opts.root || '/var/www/html';
    core = `  DocumentRoot "${root}"
  <Directory "${root}">
    Options ${indexes} FollowSymLinks
    AllowOverride None
    Require all granted
  </Directory>
`;
  } else if (opts.kind === 'php') {
    const root = opts.root || '/var/www/html';
    const sock = opts.fpmSocket || '/run/php/php8.2-fpm.sock';
    core = `  DocumentRoot "${root}"
  <Directory "${root}">
    Options ${indexes} FollowSymLinks
    AllowOverride None
    Require all granted
  </Directory>
  <FilesMatch \\.php$>
    SetHandler "proxy:unix:${sock}|fcgi://localhost"
  </FilesMatch>
`;
  } else {
    const up = opts.upstream || 'http://127.0.0.1:3000';
    core = `  ProxyPreserveHost On
  ProxyPass / ${up.endsWith('/') ? up : up + '/'}
  ProxyPassReverse / ${up.endsWith('/') ? up : up + '/'}
  RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}
`;
  }

  if (opts.ssl && opts.forceHttps) {
    return `# YSK managed
<VirtualHost *:80>
  ServerName ${name}
  Redirect permanent / https://${name.split(/\s+/)[0]}/
</VirtualHost>

<VirtualHost *:443>
  ServerName ${name}
  SSLEngine on
  SSLCertificateFile /etc/letsencrypt/live/${name.split(/\s+/)[0]}/fullchain.pem
  SSLCertificateKeyFile /etc/letsencrypt/live/${name.split(/\s+/)[0]}/privkey.pem
${hsts}${body}${core}</VirtualHost>
`;
  }

  if (opts.ssl) {
    return `# YSK managed
<VirtualHost *:80>
  ServerName ${name}
${body}${core}</VirtualHost>

<VirtualHost *:443>
  ServerName ${name}
  SSLEngine on
  SSLCertificateFile /etc/letsencrypt/live/${name.split(/\s+/)[0]}/fullchain.pem
  SSLCertificateKeyFile /etc/letsencrypt/live/${name.split(/\s+/)[0]}/privkey.pem
${hsts}${body}${core}</VirtualHost>
`;
  }

  return `# YSK managed
<VirtualHost *:80>
  ServerName ${name}
${body}${core}</VirtualHost>
`;
}

function parseBodyBytes(s: string): number {
  const m = /^(\d+)(m|k)?$/i.exec(s.trim());
  if (!m) return 10485760;
  const n = Number(m[1]);
  const u = (m[2] || '').toLowerCase();
  if (u === 'k') return n * 1024;
  if (u === 'm') return n * 1024 * 1024;
  return n;
}
