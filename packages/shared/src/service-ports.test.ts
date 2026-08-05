import { describe, expect, it } from 'vitest';
import {
  YSK_SERVICE_PORTS,
  isPortRange,
  listFirewallPortChips,
  parsePortSpec,
} from './service-ports.js';

describe('service-ports', () => {
  it('covers core YSK services', () => {
    const ports = YSK_SERVICE_PORTS.map((p) => p.port);
    expect(ports).toEqual(expect.arrayContaining(['9287', '22', '80', '443', '21', '25', '53', '3306', '5432', '6379']));
    expect(YSK_SERVICE_PORTS.some((p) => p.port === '30000:30100')).toBe(true);
    expect(YSK_SERVICE_PORTS.some((p) => p.service === 'ysk-server')).toBe(true);
  });

  it('chips include DNS tcp+udp and skip mariadb dup', () => {
    const chips = listFirewallPortChips();
    expect(chips.filter((c) => c.port === '53').length).toBe(2);
    expect(chips.some((c) => c.value === '53/udp')).toBe(true);
    expect(chips.some((c) => c.value === '53/tcp')).toBe(true);
    expect(chips.some((c) => c.label.includes('MariaDB'))).toBe(false);
    expect(chips.some((c) => c.label.includes('MySQL'))).toBe(true);
    expect(chips.some((c) => c.value === '9287/tcp')).toBe(true);
  });

  it('parsePortSpec handles single and range', () => {
    expect(parsePortSpec('8080')).toEqual({ from: 8080, to: 8080 });
    expect(parsePortSpec('30000:30100')).toEqual({ from: 30000, to: 30100 });
    expect(parsePortSpec('bad')).toBeNull();
    expect(isPortRange('30000:30100')).toBe(true);
    expect(isPortRange('80')).toBe(false);
  });
});

