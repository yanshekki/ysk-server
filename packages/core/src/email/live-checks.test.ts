import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createServer } from 'node:net';

vi.mock('node:dns/promises', () => ({
  resolveMx: vi.fn(async () => [{ priority: 10, exchange: 'mail.example.com' }]),
  resolveTxt: vi.fn(async (name: string) => {
    if (name.startsWith('_dmarc')) return [['v=DMARC1; p=none']];
    if (name.includes('_domainkey')) return [['v=DKIM1; k=rsa; p=ABCDEF']];
    return [['v=spf1 include:_spf.example.com -all']];
  }),
  reverse: vi.fn(async () => ['mail.example.com.']),
}));

vi.mock('./dnsbl.js', () => ({
  checkIpDnsbl: vi.fn(async () => ({
    ok: true,
    listedOn: [],
    cleanOn: ['zen.spamhaus.org', 'bl.spamcop.net', 'b.barracudacentral.org'],
    checked: [],
  })),
}));

// probeTcp is real — import after mocks for runLiveEmailChecks
import { probeTcp, runLiveEmailChecks } from './live-checks.js';

describe('probeTcp', () => {
  it('returns true when port accepts connections', async () => {
    const server = createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const ok = await probeTcp('127.0.0.1', addr.port, 2000);
    expect(ok).toBe(true);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('returns false for closed port', async () => {
    const ok = await probeTcp('127.0.0.1', 1, 500);
    expect(ok).toBe(false);
  });
});

describe('runLiveEmailChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scores domain using mocked DNS', async () => {
    const r = await runLiveEmailChecks({
      domain: 'example.com',
      serverIp: '203.0.113.10',
      mailHostname: 'mail.example.com',
      dkimPublicKey: 'ABCDEF',
    });
    expect(r.mx.ok).toBe(true);
    expect(r.spf.ok).toBe(true);
    expect(r.dkim.ok).toBe(true);
    expect(r.dmarc.ok).toBe(true);
    expect(r.ptr.ok).toBe(true);
    expect(r.dnsbl.ok).toBe(true);
    expect(r.health.score).toBeGreaterThan(0);
  });
});
