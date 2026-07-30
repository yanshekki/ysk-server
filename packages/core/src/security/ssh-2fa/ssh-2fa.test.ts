import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTotpCode } from '../totp.js';
import {
  enrollSsh2fa,
  confirmSsh2fa,
  listSsh2fa,
  revealSsh2faSecret,
  retireSsh2fa,
} from './store.js';
import {
  buildGoogleAuthenticatorFile,
  installSsh2faFile,
  uninstallSsh2faFile,
} from './install.js';

describe('ssh-2fa', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ysk-ssh2fa-'));
    delete process.env.YSK_SECRETS_KEY;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('enroll + confirm + install file', async () => {
    const home = join(dataDir, 'home-u');
    const en = enrollSsh2fa(dataDir, {
      linuxUser: 'ysks_demo',
      homeDir: home,
    });
    expect(en.ok).toBe(true);
    expect(en.secret).toBeTruthy();
    expect(en.otpauthUrl).toContain('otpauth://totp/');
    expect(listSsh2fa(dataDir)).toHaveLength(1);
    expect(JSON.stringify(listSsh2fa(dataDir))).not.toContain(en.secret!);

    const code = generateTotpCode(en.secret!);
    const conf = confirmSsh2fa(dataDir, en.record!.id, code);
    expect(conf.ok).toBe(true);
    expect(conf.record?.status).toBe('confirmed');

    const dry = await installSsh2faFile({
      dataDir,
      id: en.record!.id,
      apply: false,
    });
    expect(dry.dryRun).toBe(true);
    expect(existsSync(join(home, '.google_authenticator'))).toBe(false);

    const applied = await installSsh2faFile({
      dataDir,
      id: en.record!.id,
      apply: true,
      executeEnabled: true,
    });
    expect(applied.ok).toBe(true);
    expect(applied.applied).toBe(true);
    const path = join(home, '.google_authenticator');
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, 'utf8');
    expect(body.startsWith(en.secret!)).toBe(true);
    expect(body).toContain('TOTP_AUTH');
    expect(applied.scratchCodes?.length).toBe(5);
    expect(body).toMatch(/\n\d{8}/);

    const un = await uninstallSsh2faFile({
      dataDir,
      id: en.record!.id,
      apply: true,
    });
    expect(un.ok).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('reject bad confirm code', () => {
    const en = enrollSsh2fa(dataDir, {
      linuxUser: 'u1',
      homeDir: join(dataDir, 'h1'),
    });
    const bad = confirmSsh2fa(dataDir, en.record!.id, '000000');
    expect(bad.ok).toBe(false);
  });

  it('buildGoogleAuthenticatorFile format', () => {
    const f = buildGoogleAuthenticatorFile('JBSWY3DPEHPK3PXP');
    const lines = f.trim().split('\n');
    expect(lines[0]).toBe('JBSWY3DPEHPK3PXP');
    expect(lines.some((l) => l.startsWith('" RATE_LIMIT'))).toBe(true);
  });

  it('reveal secret', () => {
    const en = enrollSsh2fa(dataDir, {
      linuxUser: 'u2',
      homeDir: join(dataDir, 'h2'),
    });
    const r = revealSsh2faSecret(dataDir, en.record!.id);
    expect(r.ok).toBe(true);
    expect(r.secret).toBe(en.secret);
  });

  it('retire', () => {
    const en = enrollSsh2fa(dataDir, {
      linuxUser: 'u3',
      homeDir: join(dataDir, 'h3'),
    });
    expect(retireSsh2fa(dataDir, en.record!.id).ok).toBe(true);
    expect(listSsh2fa(dataDir)).toHaveLength(0);
  });
});
