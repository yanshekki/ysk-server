/**
 * Smoke: domain DTOs are exportable and structural (no runtime logic).
 */
import { describe, expect, it } from 'vitest';
import type {
  MetricsSnapshotDto,
  NetworkSnapshotDto,
  ProductionReadinessDto,
  FtpsSettingsDto,
  EmailDomainDto,
  DbEngineStatusDto,
} from './index.js';
import { assertHonestOps, isApplyStatus } from './index.js';

describe('domain DTO surface', () => {
  it('exports apply honesty helpers still', () => {
    expect(isApplyStatus('written')).toBe(true);
    const r = assertHonestOps({ ok: true, notes: ['x'], apply_status: 'written' });
    expect(r.ok).toBe(true);
  });

  it('accepts structural metrics snapshot', () => {
    const snap: MetricsSnapshotDto = {
      at: new Date().toISOString(),
      loadavg: [0.1, 0.2, 0.3],
      cpuCount: 4,
      memory: { total: 1, free: 1, usedRatio: 0 },
      uptimeSec: 1,
      alerts: [],
    };
    expect(snap.cpuCount).toBe(4);
  });

  it('accepts structural network / readiness / ftps / email / db shapes', () => {
    const net: Pick<NetworkSnapshotDto, 'ok' | 'at' | 'notes'> = {
      ok: true,
      at: 't',
      notes: [],
    };
    const ready: Pick<ProductionReadinessDto, 'product' | 'productionReady' | 'items'> = {
      product: 'YSK',
      productionReady: false,
      items: [],
    };
    const ftps: Pick<FtpsSettingsDto, 'listenPort' | 'sslEnable'> = {
      listenPort: 21,
      sslEnable: true,
    };
    const mail: Pick<EmailDomainDto, 'id' | 'domain' | 'health_score' | 'server_ip'> = {
      id: '1',
      domain: 'example.com',
      health_score: 0,
      server_ip: '1.2.3.4',
    };
    const db: Pick<DbEngineStatusDto, 'engine' | 'title' | 'clientInstalled' | 'serverInstalled'> =
      {
        engine: 'mysql',
        title: 'MySQL',
        clientInstalled: true,
        serverInstalled: false,
      };
    expect(net.ok && ready.product && ftps.listenPort && mail.domain && db.engine).toBeTruthy();
  });
});
