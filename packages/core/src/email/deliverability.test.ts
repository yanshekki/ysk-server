import { describe, expect, it, vi } from 'vitest';

vi.mock('./live-checks.js', () => ({
  runLiveEmailChecks: vi.fn(async () => ({
    mx: { ok: true, detail: '10 mail.example.com' },
    spf: { ok: true, detail: 'v=spf1 …' },
    dkim: { ok: true, detail: 'v=DKIM1…' },
    dmarc: { ok: false, detail: 'no DMARC' },
    ptr: { ok: false, detail: 'no PTR' },
    port25: { ok: false, detail: 'blocked' },
    dnsbl: { ok: true, detail: 'clean' },
    health: { score: 70, grade: 'C', messages: [], records: [] },
  })),
}));

vi.mock('./relay.js', () => ({
  loadSmtpRelaySettings: () => null,
}));

import { buildDeliverabilityReport } from './deliverability.js';

describe('buildDeliverabilityReport', () => {
  it('never claims deliveryGuaranteed and lists external PTR/port25', async () => {
    const r = await buildDeliverabilityReport({
      domain: 'example.com',
      serverIp: '203.0.113.10',
      dkimPublicKey: 'ABCkey',
    });
    expect(r.deliveryGuaranteed).toBe(false);
    expect(r.honesty.length).toBeGreaterThan(0);
    expect(r.items.find((i) => i.id === 'ptr')?.owner).toBe('vps_provider');
    expect(r.items.find((i) => i.id === 'port25')?.owner).toBe('vps_provider');
    expect(r.warmup.phases.length).toBeGreaterThan(0);
    expect(r.panelReady).toBe(true); // mx/spf/dkim/dnsbl ok
  });
});
