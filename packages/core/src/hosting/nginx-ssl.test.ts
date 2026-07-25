import { describe, expect, it } from 'vitest';
import { planLetsEncrypt, renderNginxProxy } from './nginx-ssl.js';

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
});
