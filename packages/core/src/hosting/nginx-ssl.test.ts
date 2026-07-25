import { describe, expect, it } from 'vitest';
import { planLetsEncrypt, renderNginxPhpFpm, renderNginxProxy } from './nginx-ssl.js';

describe('nginx + ssl', () => {
  it('renders reverse proxy with cloudflare real ip and ssl', () => {
    const conf = renderNginxProxy({
      serverName: 'app.example.com',
      upstream: 'http://127.0.0.1:3000',
      ssl: true,
      cloudflareRealIp: true,
    });
    expect(conf).toContain('listen 443 ssl');
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
});
