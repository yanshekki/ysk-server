import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import {
  applyEmailStack,
  applyPhpHosting,
  applyFtps,
  applyNginxSite,
  writeControlPlaneSystemdUnit,
  applyFirewall,
} from './system-apply.js';

describe('system-level apply writers', () => {
  it('writes email postfix/dovecot/opendkim configs under dataDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sys-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await applyEmailStack({
      dataDir: dir,
      domain: 'example.com',
      host,
      installPackages: false,
    });
    expect(r.written.length).toBeGreaterThan(5);
    expect(existsSync(r.written[0])).toBe(true);
    expect(readFileSync(r.written[0], 'utf8')).toContain('myhostname');
    expect(readFileSync(r.written[0], 'utf8')).toContain('smtpd_milters');
    expect(r.written.some((p) => p.endsWith('install-mta.sh'))).toBe(true);
    expect(r.ok).toBe(true);

    const installSkip = await applyEmailStack({
      dataDir: dir,
      domain: 'example.com',
      host,
      installPackages: true,
    });
    expect(installSkip.ok).toBe(false);
    expect(installSkip.notes.some((n) => /YSK_EXECUTE/i.test(n))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes php vhost and nginx site configs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sys-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const php = await applyPhpHosting({
      dataDir: dir,
      domain: 'php.example.com',
      docRoot: join(dir, 'www'),
      phpVersion: '8.2',
      poolName: 'demo',
      host,
    });
    expect(existsSync(php.written[0])).toBe(true);
    const ngx = await applyNginxSite({
      dataDir: dir,
      serverName: 'app.example.com',
      upstream: 'http://127.0.0.1:3000',
      host,
    });
    expect(existsSync(ngx.written[0])).toBe(true);
    const ftps = await applyFtps({ dataDir: dir, domain: 'files.example.com', host });
    expect(existsSync(ftps.written[0])).toBe(true);
    expect(ftps.ok).toBe(true);
    const ftpsInstall = await applyFtps({
      dataDir: dir,
      domain: 'files.example.com',
      host,
      install: true,
    });
    expect(ftpsInstall.ok).toBe(false);
    expect(ftpsInstall.notes.some((n) => /YSK_EXECUTE/i.test(n))).toBe(true);
    const unit = writeControlPlaneSystemdUnit({
      dataDir: dir,
      cliPath: '/usr/bin/ysk-server',
    });
    expect(existsSync(unit.unitPath)).toBe(true);
    expect(unit.content).toContain('ysk-server');
    const fw = await applyFirewall({
      host,
      dataDir: dir,
      apply: false,
      allowSmtp: true,
    });
    expect(fw.commands.some((c) => c.includes('25'))).toBe(true);
    expect(fw.written.some((p) => p.endsWith('ufw-apply.sh'))).toBe(true);
    expect(fw.ok).toBe(true);

    const fwApplySkip = await applyFirewall({
      host,
      dataDir: dir,
      apply: true,
      allowSmtp: true,
    });
    expect(fwApplySkip.ok).toBe(false);
    expect(fwApplySkip.notes.some((n) => /YSK_EXECUTE/i.test(n))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
