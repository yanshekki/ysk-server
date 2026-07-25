import { describe, expect, it } from 'vitest';
import {
  buildExternalTodos,
  generateEmailDnsRecords,
  planEmailStackInstall,
  scoreEmailHealth,
} from './dns-records.js';

describe('email DNS + external checklist', () => {
  const base = {
    domain: 'example.com',
    serverIp: '203.0.113.10',
    dkimPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0testkey',
  };

  it('generates MX SPF DKIM DMARC records', () => {
    const records = generateEmailDnsRecords(base);
    const types = records.map((r) => r.type);
    expect(types).toContain('MX');
    expect(records.find((r) => r.type === 'TXT' && r.name === '@')?.value).toMatch(/v=spf1/);
    expect(records.find((r) => r.name.includes('_domainkey'))?.value).toMatch(/v=DKIM1/);
    expect(records.find((r) => r.name === '_dmarc')?.value).toMatch(/v=DMARC1/);
  });

  it('includes PTR and Port25 messaging in external todos', () => {
    const todos = buildExternalTodos({
      domain: 'example.com',
      mailHostname: 'mail.example.com',
      ptrOk: false,
      port25Open: false,
    });
    const ptr = todos.find((t) => t.id === 'ptr');
    const p25 = todos.find((t) => t.id === 'port25');
    expect(ptr?.description).toMatch(/PTR|Reverse DNS/i);
    expect(ptr?.description).toMatch(/VPS|provider/i);
    expect(p25?.description).toMatch(/Port 25/i);
    expect(p25?.description).toMatch(/relay|unblock/i);
  });

  it('scores health and plans stack install', () => {
    const report = scoreEmailHealth({
      ...base,
      dnsApplied: true,
      dmarcPresent: true,
      ptrOk: false,
      port25Open: false,
    });
    expect(report.score).toBeLessThan(100);
    expect(report.messages.some((m) => /PTR/i.test(m))).toBe(true);
    expect(report.messages.some((m) => /Port 25/i.test(m))).toBe(true);
    expect(report.records.some((r) => r.type === 'MX')).toBe(true);

    const install = planEmailStackInstall('example.com');
    expect(install.packages).toContain('postfix');
    expect(install.packages).toContain('dovecot-core');
    expect(install.ports).toContain(25);
  });
});
