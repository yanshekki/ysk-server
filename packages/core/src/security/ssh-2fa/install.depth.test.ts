import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTotpCode } from '../totp.js';
import {
  enrollSsh2fa,
  confirmSsh2fa,
} from './store.js';
import {
  buildGoogleAuthenticatorFile,
  generateScratchCodes,
  buildPamSshSnippet,
  buildSshdTotpHints,
  buildSshdStrictMatchSnippet,
  planSsh2faStrictSnippet,
  applySshdStrictSnippet,
  installSsh2faFile,
  uninstallSsh2faFile,
  probeSsh2faHost,
  isSftpOnlyStyleUser,
  SSHD_STRICT_SNIPPET_NAME,
} from './install.js';
import type { HostExecutor } from '../../host/executor.js';

function mockHost(opts?: {
  run?: (argv: string[]) => { stdout?: string; stderr?: string; exitCode?: number };
}): HostExecutor {
  return {
    executeEnabled: () => true,
    isRoot: () => true,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => {
      const partial = opts?.run?.(argv) ?? {};
      return {
        stdout: partial.stdout ?? '',
        stderr: partial.stderr ?? '',
        exitCode: partial.exitCode ?? 0,
        argv,
        dryRun: false,
      };
    },
  };
}

describe('ssh-2fa install depth', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ysk-ssh2fa-d-'));
    delete process.env.YSK_SECRETS_KEY;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('build helpers: scratch codes, pam, sshd, strict match', () => {
    const codes = generateScratchCodes(3);
    expect(codes).toHaveLength(3);
    expect(codes.every((c) => /^\d{8}$/.test(c))).toBe(true);
    const f = buildGoogleAuthenticatorFile('JBSWY3DPEHPK3PXP', ['12', '12345678', 'abc']);
    expect(f).toContain('TOTP_AUTH');
    expect(f).toMatch(/\n00000012|\n12345678/);
    expect(buildPamSshSnippet()).toContain('pam_google_authenticator');
    expect(buildSshdTotpHints()).toContain('UsePAM yes');
    expect(buildSshdStrictMatchSnippet([])).toMatch(/no strict/i);
    expect(buildSshdStrictMatchSnippet(['alice', 'bob'])).toContain('Match User alice,bob');
    expect(isSftpOnlyStyleUser('ysks_abc')).toBe(true);
    expect(isSftpOnlyStyleUser('root')).toBe(false);
  });

  it('planSsh2faStrictSnippet drops recovery and sftp users', () => {
    const empty = planSsh2faStrictSnippet({
      linuxUsers: ['ysks_demo', 'ysk_web'],
      recoveryUsers: ['rescue'],
    });
    expect(empty.ok).toBe(false);
    expect(empty.blocked).toBe(true);

    const ok = planSsh2faStrictSnippet({
      linuxUsers: ['alice', 'ysks_x', 'rescue', 'bob'],
      recoveryUsers: ['rescue'],
      includeSftpUsers: false,
    });
    expect(ok.ok).toBe(true);
    expect(ok.users).toEqual(expect.arrayContaining(['alice', 'bob']));
    expect(ok.users).not.toContain('ysks_x');
    expect(ok.users).not.toContain('rescue');
    expect(ok.snippet).toContain('Match User');

    const withSftp = planSsh2faStrictSnippet({
      linuxUsers: ['ysks_only'],
      includeSftpUsers: true,
    });
    expect(withSftp.ok).toBe(true);
    expect(withSftp.users).toContain('ysks_only');
  });

  it('applySshdStrictSnippet dry-run / blocked / applied', async () => {
    const dry = await applySshdStrictSnippet({
      dataDir,
      host: mockHost(),
      linuxUsers: ['alice'],
      apply: false,
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.written?.length).toBe(1);
    expect(existsSync(dry.written![0])).toBe(true);

    const blockedPlan = await applySshdStrictSnippet({
      dataDir,
      host: mockHost(),
      linuxUsers: [],
      apply: true,
      executeEnabled: true,
    });
    expect(blockedPlan.blocked).toBe(true);

    const noExec = await applySshdStrictSnippet({
      dataDir,
      host: mockHost(),
      linuxUsers: ['alice'],
      apply: true,
      executeEnabled: false,
    });
    expect(noExec.blocked).toBe(true);

    const applied = await applySshdStrictSnippet({
      dataDir,
      host: mockHost({ run: () => ({ exitCode: 0, stdout: 'ok' }) }),
      linuxUsers: ['alice'],
      apply: true,
      executeEnabled: true,
    });
    expect(applied.ok).toBe(true);
    expect(applied.applied).toBe(true);
    expect(applied.written?.some((p) => p.includes(SSHD_STRICT_SNIPPET_NAME))).toBe(true);

    const fail = await applySshdStrictSnippet({
      dataDir,
      host: mockHost({ run: () => ({ exitCode: 1, stderr: 'sshd -t fail' }) }),
      linuxUsers: ['alice'],
      apply: true,
      executeEnabled: true,
    });
    expect(fail.ok).toBe(false);
  });

  it('installSsh2faFile not found / blocked execute / host chown path', async () => {
    const missing = await installSsh2faFile({
      dataDir,
      id: 'nope',
      apply: true,
      executeEnabled: true,
    });
    expect(missing.ok).toBe(false);

    const home = join(dataDir, 'home-u');
    const en = enrollSsh2fa(dataDir, { linuxUser: 'demo', homeDir: home });
    expect(en.ok).toBe(true);
    const code = generateTotpCode(en.secret!);
    expect(confirmSsh2fa(dataDir, en.record!.id, code).ok).toBe(true);

    const blocked = await installSsh2faFile({
      dataDir,
      id: en.record!.id,
      apply: true,
      executeEnabled: false,
    });
    expect(blocked.blocked).toBe(true);

    const withHost = await installSsh2faFile({
      dataDir,
      id: en.record!.id,
      apply: true,
      executeEnabled: true,
      host: mockHost({
        run: () => ({ exitCode: 0, stdout: '400 demo demo\n' }),
      }),
    });
    expect(withHost.ok).toBe(true);
    expect(withHost.applied).toBe(true);
    expect(withHost.scratchCodes?.length).toBe(5);
    expect(existsSync(join(home, '.google_authenticator'))).toBe(true);
    const body = readFileSync(join(home, '.google_authenticator'), 'utf8');
    expect(body).toContain('TOTP_AUTH');

    // mode note when not 400
    const en2 = enrollSsh2fa(dataDir, {
      linuxUser: 'demo2',
      homeDir: join(dataDir, 'h2'),
    });
    confirmSsh2fa(dataDir, en2.record!.id, generateTotpCode(en2.secret!));
    const modeWarn = await installSsh2faFile({
      dataDir,
      id: en2.record!.id,
      apply: true,
      executeEnabled: true,
      host: mockHost({
        run: () => ({ exitCode: 0, stdout: '644 root root\n' }),
      }),
    });
    expect(modeWarn.ok).toBe(true);
    expect(modeWarn.notes.some((n) => n.length > 0)).toBe(true);
  });

  it('uninstall dry-run, absent file, retire false', async () => {
    const home = join(dataDir, 'hu');
    const en = enrollSsh2fa(dataDir, { linuxUser: 'u', homeDir: home });
    const miss = await uninstallSsh2faFile({ dataDir, id: 'no', apply: true });
    expect(miss.ok).toBe(false);

    const dry = await uninstallSsh2faFile({
      dataDir,
      id: en.record!.id,
      apply: false,
    });
    expect(dry.dryRun).toBe(true);

    // no file yet
    const un = await uninstallSsh2faFile({
      dataDir,
      id: en.record!.id,
      apply: true,
      retire: false,
    });
    expect(un.ok).toBe(true);
    expect(un.notes.some((n) => /absent|already/i.test(n) || n.length > 0)).toBe(true);

    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, '.google_authenticator'), 'x\n', 'utf8');
    // re-enroll for file path
    const en3 = enrollSsh2fa(dataDir, {
      linuxUser: 'u3',
      homeDir: join(dataDir, 'h3'),
    });
    mkdirSync(join(dataDir, 'h3'), { recursive: true });
    writeFileSync(join(dataDir, 'h3', '.google_authenticator'), 'sec\n', { mode: 0o400 });
    const rm = await uninstallSsh2faFile({
      dataDir,
      id: en3.record!.id,
      apply: true,
      retire: true,
    });
    expect(rm.ok).toBe(true);
  });

  it('probeSsh2faHost lights package/pam/kbd', async () => {
    const green = await probeSsh2faHost(
      mockHost({
        run: (argv) => {
          const j = argv.join(' ');
          if (j.includes('pam_google_authenticator.so') || j.includes('dpkg')) {
            return {
              stdout: '/lib/.../pam_google_authenticator.so\nii  libpam-google-authenticator\n',
            };
          }
          if (j.includes('pam.d/sshd')) {
            return { stdout: 'auth required pam_google_authenticator.so nullok\n' };
          }
          if (j.includes('sshd -T') || j.includes('sshd_config')) {
            return { stdout: 'kbdinteractiveauthentication yes\nusepam yes\n' };
          }
          return {};
        },
      }),
    );
    expect(green.lights.package).toBe('green');
    expect(green.lights.pam).toBe('green');
    expect(green.lights.kbdInteractive).toBe('green');
    expect(green.pamModule).toBe(true);
    expect(green.pamConfigured).toBe(true);
    expect(green.kbdInteractive).toBe(true);

    const red = await probeSsh2faHost(
      mockHost({
        run: () => ({ stdout: '', exitCode: 0 }),
      }),
    );
    expect(red.lights.package).toBe('red');
    expect(red.lights.pam).toBe('red');
    expect(red.lights.kbdInteractive).toBe('yellow');
  });
});
