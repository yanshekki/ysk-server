import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { classifyRfbProbeError, probeRfbTcp } from './rfb-probe.js';

describe('rfb-probe', () => {
  it('classifies refused / timeout / dns', () => {
    expect(classifyRfbProbeError({ code: 'ECONNREFUSED' }, '1.2.3.4', 5901).code).toBe(
      'rfb_refused',
    );
    expect(classifyRfbProbeError({ code: 'ETIMEDOUT' }, '1.2.3.4', 5901).code).toBe(
      'rfb_timeout',
    );
    expect(classifyRfbProbeError({ code: 'ENOTFOUND' }, 'no.such.host', 5901).code).toBe(
      'rfb_dns',
    );
  });

  it('probes open local port ok', async () => {
    const server = createServer((s) => s.end());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    const res = await probeRfbTcp('127.0.0.1', port, 2000);
    expect(res.ok).toBe(true);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('probes closed port as refused or error', async () => {
    // high unused port — may be refused quickly
    const res = await probeRfbTcp('127.0.0.1', 1, 1500);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(['rfb_refused', 'rfb_timeout', 'rfb_error', 'rfb_net']).toContain(res.code);
    }
  });
});
