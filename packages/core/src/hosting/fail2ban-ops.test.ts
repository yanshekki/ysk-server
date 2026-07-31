import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_F2B_POLICY,
  FAIL2BAN_JAIL_CATALOG,
  readIgnoreIpList,
  writeFail2banJailLocal,
} from './fail2ban-ops.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ysk-f2b-'));
  dirs.push(d);
  return d;
}

describe('fail2ban-ops pure', () => {
  it('catalog has unique jail ids and default policy is coherent', () => {
    const ids = FAIL2BAN_JAIL_CATALOG.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('sshd');
    expect(DEFAULT_F2B_POLICY.maxretry).toBe(5);
    expect(DEFAULT_F2B_POLICY.jails).toContain('sshd');
    for (const j of DEFAULT_F2B_POLICY.jails) {
      expect(ids).toContain(j);
    }
  });

  it('readIgnoreIpList returns empty when missing and parses lines when present', () => {
    const dir = tmp();
    expect(readIgnoreIpList(dir)).toEqual([]);
    mkdirSync(join(dir, 'fail2ban'), { recursive: true });
    writeFileSync(
      join(dir, 'fail2ban', 'ignoreip.txt'),
      '10.0.0.1\n\n  192.168.1.0/24 \n# not filtered but present\n',
      'utf8',
    );
    const list = readIgnoreIpList(dir);
    expect(list).toEqual(['10.0.0.1', '192.168.1.0/24', '# not filtered but present']);
  });

  it('writeFail2banJailLocal writes jail.local with policy and ignore list', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'fail2ban'), { recursive: true });
    writeFileSync(join(dir, 'fail2ban', 'ignoreip.txt'), '10.1.2.3\n', 'utf8');

    const { path, body } = writeFail2banJailLocal(dir, {
      bantime: '2h',
      findtime: '15m',
      maxretry: 8,
      jails: ['sshd', 'postfix', 'evil;rm'],
    });
    expect(path).toBe(join(dir, 'fail2ban', 'jail.local'));
    expect(existsSync(path)).toBe(true);
    expect(body).toContain('bantime = 2h');
    expect(body).toContain('findtime = 15m');
    expect(body).toContain('maxretry = 8');
    expect(body).toContain('ignoreip = 127.0.0.1/8 ::1 10.1.2.3');
    expect(body).toContain('[sshd]');
    expect(body).toContain('[postfix]');
    // unsafe chars stripped from jail id
    expect(body).toContain('[evilrm]');
    expect(readFileSync(path, 'utf8')).toBe(body);
  });

  it('writeFail2banJailLocal sanitizes bad duration and clamps maxretry', () => {
    const dir = tmp();
    const { body } = writeFail2banJailLocal(dir, {
      bantime: 'drop table',
      findtime: '',
      maxretry: 999,
      jails: [],
    });
    expect(body).toContain('bantime = 1h');
    expect(body).toContain('findtime = 10m');
    expect(body).toContain('maxretry = 50');
    // empty jails → default list
    expect(body).toContain('[sshd]');
  });

  it('writeFail2banJailLocal accepts pure numeric duration', () => {
    const dir = tmp();
    const { body } = writeFail2banJailLocal(dir, {
      bantime: '3600',
      findtime: '600',
      maxretry: 1,
      jails: ['sshd'],
    });
    expect(body).toContain('bantime = 3600');
    expect(body).toContain('findtime = 600');
    expect(body).toContain('maxretry = 1');
  });
});
