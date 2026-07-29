import { describe, expect, it } from 'vitest';
import {
  buildServerNameList,
  planLetsEncrypt,
  renderNginxPhpFpm,
  renderNginxProxy,
  renderNginxStatic,
  renderNginxSuspended,
} from './nginx-ssl.js';

describe('nginx + ssl', () => {
  it('renders reverse proxy with cloudflare real ip and ssl', () => {
    const conf = renderNginxProxy({
      serverName: 'app.example.com',
      upstream: 'http://127.0.0.1:3000',
      ssl: true,
      cloudflareRealIp: true,
    });
    expect(conf).toContain('listen 443 ssl');
    expect(conf).toContain('listen [::]:443');
    expect(conf).toContain('listen [::]:80');
    expect(conf).toContain('proxy_pass http://127.0.0.1:3000');
    expect(conf).toContain('CF-Connecting-IP');
    expect(conf).toContain('letsencrypt');
  });

  it('uses uploaded cert paths when provided', () => {
    const conf = renderNginxProxy({
      serverName: 'app.example.com',
      upstream: 'http://127.0.0.1:3000',
      ssl: true,
      cloudflareRealIp: false,
      sslCertificate: '/data/certs/app.example.com/fullchain.pem',
      sslCertificateKey: '/data/certs/app.example.com/privkey.pem',
    });
    expect(conf).toContain('/data/certs/app.example.com/fullchain.pem');
    expect(conf).not.toContain('letsencrypt');
  });

  it('plans certbot letsencrypt commands', () => {
    const plan = planLetsEncrypt({
      domain: 'app.example.com',
      email: 'admin@example.com',
      provider: 'letsencrypt',
      challenge: 'http-01',
    });
    expect(plan.commands[0]).toContain('certbot');
    expect(plan.commands[0]).toContain('app.example.com');
  });

  it('renders PHP-FPM fastcgi server block', () => {
    const conf = renderNginxPhpFpm({
      serverName: 'php.example.com',
      docRoot: '/var/www/php',
      fpmSocket: '/run/php/php8.2-fpm-demo.sock',
      cloudflareRealIp: true,
    });
    expect(conf).toContain('fastcgi_pass unix:/run/php/php8.2-fpm-demo.sock');
    expect(conf).toContain('root /var/www/php');
    expect(conf).toContain('try_files');
  });

  it('renders static site server block', () => {
    const conf = renderNginxStatic({
      serverName: 'static.example.com',
      docRoot: '/var/www/static',
      cloudflareRealIp: true,
    });
    expect(conf).toContain('root /var/www/static');
    expect(conf).toContain('try_files $uri $uri/ /index.html');
    expect(conf).toContain('expires 7d');
  });

  it('builds server_name list with aliases', () => {
    expect(buildServerNameList('app.example.com', ['www.example.com', 'app.example.com'])).toBe(
      'app.example.com www.example.com',
    );
  });

  it('forceHttps + hsts emits redirect and STS header', () => {
    const conf = renderNginxProxy({
      serverName: 'app.example.com www.example.com',
      upstream: 'http://127.0.0.1:3000',
      ssl: true,
      cloudflareRealIp: false,
      forceHttps: true,
      hsts: true,
    });
    expect(conf).toContain('return 301 https://$host$request_uri');
    expect(conf).toContain('Strict-Transport-Security');
    expect(conf).toContain('server_name app.example.com www.example.com');
  });

  it('site redirect + auth_basic on proxy', () => {
    const redir = renderNginxProxy({
      serverName: 'old.example.com',
      upstream: 'http://127.0.0.1:3000',
      ssl: false,
      cloudflareRealIp: false,
      siteRedirectUrl: 'https://new.example.com',
    });
    expect(redir).toContain('return 301 https://new.example.com$request_uri');
    expect(redir).not.toContain('proxy_pass');

    const auth = renderNginxProxy({
      serverName: 'app.example.com',
      upstream: 'http://127.0.0.1:3000',
      ssl: false,
      cloudflareRealIp: false,
      authBasicUserFile: '/data/nginx/htpasswd/demo.htpasswd',
      authBasicRealm: 'Restricted',
    });
    expect(auth).toContain('auth_basic "Restricted"');
    expect(auth).toContain('auth_basic_user_file /data/nginx/htpasswd/demo.htpasswd');
  });

  it('php/static carry auth and site redirect', () => {
    const php = renderNginxPhpFpm({
      serverName: 'php.example.com',
      docRoot: '/home/p/app',
      fpmSocket: '/run/php/php8.2-fpm-x.sock',
      authBasicUserFile: '/data/ht/x',
    });
    expect(php).toContain('auth_basic_user_file /data/ht/x');
    expect(php).toContain('expires 7d');

    const st = renderNginxStatic({
      serverName: 's.example.com',
      docRoot: '/home/p/app',
      siteRedirectUrl: 'https://elsewhere.example.com',
    });
    expect(st).toContain('return 301 https://elsewhere.example.com$request_uri');
    expect(st).not.toContain('try_files');
  });

  it('renders suspended 503 vhost', () => {
    const conf = renderNginxSuspended('app.example.com www.example.com');
    expect(conf).toContain('return 503');
    expect(conf).toContain('app.example.com www.example.com');
  });
});
