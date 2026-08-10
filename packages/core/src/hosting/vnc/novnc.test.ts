import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildConnectionPayload, createViewTicket, consumeViewTicket } from './novnc.js';

describe('novnc helpers', () => {
  it('builds dual-path connection payload', () => {
    const p = buildConnectionPayload({
      accountId: 'a1',
      name: 'Alice',
      linuxUser: 'yskvnc_alice',
      display: 2,
      rfbPort: 5902,
      rfbBind: 'localhost',
      endpointHint: '10.0.0.5',
      novncHttpPort: 6082,
      viewTicketToken: 'abc',
    });
    expect(p.direct.address).toBe('10.0.0.5:5902');
    expect(p.viaServer.available).toBe(true);
    expect(p.viaServer.localUrl).toContain('6082');
    expect(p.viaServer.ticketPath).toContain('abc');
  });

  it('issues and consumes view tickets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-novnc-'));
    const t = createViewTicket({ dataDir: dir, accountId: 'x', httpPort: 6081 });
    expect(consumeViewTicket(dir, t.token)?.httpPort).toBe(6081);
    expect(consumeViewTicket(dir, 'nope')).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
