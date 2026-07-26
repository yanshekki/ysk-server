import { describe, expect, it } from 'vitest';
import {
  planBackup,
  planCronJob,
  planDnsZone,
  planFirewall,
  planFtps,
  planLogPaths,
  planMonitoringChecks,
  planPublicFileServer,
} from './extras.js';

describe('phase3 hosting extras', () => {
  it('plans file server, ftps, dns, firewall', () => {
    const files = planPublicFileServer({ quotaMb: 512 });
    expect(files.apiPrefix).toBe('/api/v1/files');
    expect(files.quotaMb).toBe(512);

    const ftps = planFtps({ domain: 'files.example.com' });
    expect(ftps.configSnippet).toContain('ssl_enable=YES');
    expect(ftps.configSnippet).toContain('pasv_min_port');

    const dns = planDnsZone({ zone: 'example.com', serverIp: '1.2.3.4', template: 'full' });
    expect(dns.records.some((r) => r.type === 'MX')).toBe(true);
    expect(dns.records.some((r) => r.name === 'www')).toBe(true);
    expect(dns.records.some((r) => r.name === 'ftp')).toBe(true);

    const minimal = planDnsZone({ zone: 'example.com', serverIp: '1.2.3.4', template: 'minimal' });
    expect(minimal.records).toHaveLength(1);
    expect(minimal.records[0].name).toBe('@');

    const web = planDnsZone({ zone: 'example.com', serverIp: '1.2.3.4', template: 'web' });
    expect(web.records.some((r) => r.name === 'www')).toBe(true);
    expect(web.records.some((r) => r.type === 'MX')).toBe(false);

    const fw = planFirewall({ allowSmtp: true, extraTcpPorts: [2222] });
    expect(fw.rules.some((r) => r.includes('25/tcp'))).toBe(true);
    expect(fw.fail2banJails).toContain('sshd');
  });

  it('plans cron, backup, monitoring, logs', () => {
    const cron = planCronJob({
      user: 'ysk_demo',
      schedule: '0 2 * * *',
      command: '/usr/local/bin/backup.sh',
    });
    expect(cron.crontabLine).toContain('0 2 * * *');

    const backup = planBackup({
      projectId: 'p1',
      sources: ['/var/lib/ysk-server/projects/ysk_p1'],
      dest: '/var/backups/ysk',
    });
    expect(backup.commands.some((c) => c.includes('tar'))).toBe(true);

    expect(planMonitoringChecks('p1').checks.length).toBeGreaterThan(0);
    expect(planLogPaths('/home/p').app).toContain('app.log');
  });
});
