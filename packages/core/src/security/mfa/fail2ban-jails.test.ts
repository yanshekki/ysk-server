import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSshdJailHint,
  buildYskLoginFilter,
  buildYskLoginJail,
  writeFail2banSnippets,
} from './fail2ban-jails.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('mfa fail2ban-jails pure', () => {
  it('builds filter with failregex for login/totp failures', () => {
    const f = buildYskLoginFilter();
    expect(f).toContain('[Definition]');
    expect(f).toContain('failregex');
    expect(f).toContain('totp');
    expect(f).toContain('ignoreregex');
  });

  it('builds jail with default and custom logpath', () => {
    const def = buildYskLoginJail();
    expect(def).toContain('[ysk-login]');
    expect(def).toContain('filter = ysk-login');
    expect(def).toContain('/var/log/ysk-server/auth.log');
    expect(def).toContain('maxretry = 8');

    const custom = buildYskLoginJail({ logpath: '/tmp/custom-auth.log' });
    expect(custom).toContain('logpath = /tmp/custom-auth.log');
  });

  it('builds sshd jail hint snippet', () => {
    const h = buildSshdJailHint();
    expect(h).toContain('[sshd]');
    expect(h).toContain('enabled = true');
  });

  it('writes three snippets under dataDir/security/fail2ban', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mfa-f2b-'));
    dirs.push(dir);
    const r = writeFail2banSnippets(dir);
    expect(r.written).toHaveLength(3);
    expect(r.notes.length).toBeGreaterThan(0);
    for (const p of r.written) {
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, 'utf8').length).toBeGreaterThan(20);
    }
    expect(r.written.some((p) => p.endsWith('ysk-login.filter.conf'))).toBe(true);
    expect(r.written.some((p) => p.endsWith('ysk-login.jail.conf'))).toBe(true);
    expect(r.written.some((p) => p.endsWith('sshd.jail.hint.conf'))).toBe(true);
  });
});
