import { tl } from '@ysk-server/shared';
/**
 * Fail2ban jail / filter snippets for panel login + sshd (honest: written under dataDir).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function buildYskLoginFilter(): string {
  return [
    '# YSK Server — filter for panel login failures (journal or log file)',
    '# Install: /etc/fail2ban/filter.d/ysk-login.conf',
    '[Definition]',
    'failregex = ^.*auth\\.login.*ok["\']?\\s*:\\s*false.*$',
    tl('notes.auto.n0050'),
    tl('notes.auto.n0051'),
    '            ^.*"reason"\\s*:\\s*"totp".*$',
    'ignoreregex =',
    '',
  ].join('\n');
}

export function buildYskLoginJail(opts?: { logpath?: string }): string {
  const logpath = opts?.logpath || '/var/log/ysk-server/auth.log';
  return [
    '# YSK Server — jail for panel brute force',
    '# Install: /etc/fail2ban/jail.d/ysk-login.conf',
    '[ysk-login]',
    'enabled = true',
    'filter = ysk-login',
    `logpath = ${logpath}`,
    'maxretry = 8',
    'findtime = 15m',
    'bantime = 1h',
    'backend = auto',
    '',
  ].join('\n');
}

export function buildSshdJailHint(): string {
  return [
    '# Ensure sshd jail is enabled (distro default often present):',
    '# /etc/fail2ban/jail.local',
    '[sshd]',
    'enabled = true',
    'maxretry = 5',
    'findtime = 10m',
    'bantime = 1h',
    '',
  ].join('\n');
}

export function writeFail2banSnippets(dataDir: string): {
  written: string[];
  notes: string[];
} {
  const dir = join(dataDir, 'security', 'fail2ban');
  mkdirSync(dir, { recursive: true });
  const files = {
    'ysk-login.filter.conf': buildYskLoginFilter(),
    'ysk-login.jail.conf': buildYskLoginJail(),
    'sshd.jail.hint.conf': buildSshdJailHint(),
  };
  const written: string[] = [];
  for (const [name, body] of Object.entries(files)) {
    const p = join(dir, name);
    writeFileSync(p, body, 'utf8');
    written.push(p);
  }
  return {
    written,
    notes: [
      tl('notes.auto.n1203'),
      tl('notes.auto.n1348'),
      tl('notes.auto.n0366'),
    ],
  };
}
