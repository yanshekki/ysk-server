import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  LocalHostExecutor,
  commandRequiresExecute,
  pathUnderRoot,
} from './executor.js';
import { YskError } from 'ysk-server-shared';

describe('LocalHostExecutor', () => {
  it('allows managed writes and blocks mutating commands without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-exec-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    await host.writeFile(join(dir, 'a.txt'), 'hello');
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('hello');
    expect(host.pathExists(join(dir, 'a.txt'))).toBe(true);

    await expect(host.runCommand(['rm', '-rf', '/tmp/ysk-should-block'])).rejects.toThrow(
      /YSK_EXECUTE|blocked|阻擋|系統變更|權限/i,
    );

    const dry = await host.runCommand(['echo', 'x'], { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.exitCode).toBe(0);

    const echo = await host.runCommand(['bash', '-c', 'echo hi'], { timeoutMs: 5_000 });
    expect(echo.exitCode).toBe(0);
    expect(echo.stdout.trim()).toBe('hi');

    const info = await host.sysInfo();
    expect(info.hostname).toBeTruthy();
    expect(info.executeEnabled).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses write outside roots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-exec-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    await expect(host.writeFile('/etc/ysk-forbidden-test', 'x')).rejects.toThrow(YskError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('blocks path traversal via .. under write roots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-exec-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    await expect(host.writeFile(join(dir, '..', 'escape-outside.txt'), 'x')).rejects.toThrow(
      YskError,
    );
    await expect(host.mkdirp(join(dir, '..', 'escape-mkdir'))).rejects.toThrow(YskError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('mkdirp under managed root works without EXECUTE; outside needs EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-exec-mkdir-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    await host.mkdirp(join(dir, 'nested', 'ok'));
    await expect(host.mkdirp('/etc/ysk-mkdir-forbidden')).rejects.toThrow(YskError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('fail-closed: unknown interpreters require EXECUTE', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    await expect(host.runCommand(['python3', '-c', 'print(1)'])).rejects.toThrow(/YSK_EXECUTE|blocked|權限|FORBIDDEN|forbidden|notes\.auto/i);
    await expect(host.runCommand(['bash', '-c', 'echo pwn > /tmp/ysk-pwn-test'])).rejects.toThrow();
  });

  it('streams stdout lines via onChunk when requested', async () => {
    const host = new LocalHostExecutor({ executeEnabled: true });
    const lines: string[] = [];
    const r = await host.runCommand(
      ['bash', '-c', 'echo line1; echo line2; echo line3'],
      {
        timeoutMs: 5_000,
        onChunk: (c) => {
          if (c.stream === 'stdout' && c.text) lines.push(c.text);
        },
      },
    );
    expect(r.exitCode).toBe(0);
    expect(lines).toEqual(expect.arrayContaining(['line1', 'line2', 'line3']));
  });
});

describe('pathUnderRoot + commandRequiresExecute', () => {
  it('resolves .. escape attempts', () => {
    expect(pathUnderRoot('/tmp/ysk-root', '/tmp/ysk-root/a')).toBe(true);
    expect(pathUnderRoot('/tmp/ysk-root', '/tmp/ysk-root/../etc/passwd')).toBe(false);
    expect(pathUnderRoot('/home/u', '/home/u2/secret')).toBe(false);
  });

  it('defaults unknown bins to require execute', () => {
    expect(commandRequiresExecute(['python3', '-c', 'x'])).toBe(true);
    expect(commandRequiresExecute(['systemctl', 'is-active', 'ssh'])).toBe(false);
    expect(commandRequiresExecute(['bash', '-c', 'echo hi'])).toBe(false);
    expect(commandRequiresExecute(['bash', '-c', 'rm -rf /'])).toBe(true);
    expect(commandRequiresExecute(['bash', '-c', 'postqueue -p'])).toBe(false);
    expect(
      commandRequiresExecute([
        'bash',
        '-c',
        'for p in "nginx" "ufw" "fail2ban"; do apt-cache policy "$p"; done',
      ]),
    ).toBe(false);
    expect(
      commandRequiresExecute(['bash', '-c', 'apt-cache policy ufw; ufw enable']),
    ).toBe(true);
    expect(commandRequiresExecute(['bash', '-c', 'postqueue -p; reboot'])).toBe(true);
    expect(commandRequiresExecute(['bash', '-c', 'grep x /etc/passwd; reboot'])).toBe(true);
    expect(
      commandRequiresExecute([
        'bash',
        '-c',
        'if command -v postqueue >/dev/null 2>&1; then postqueue -p 2>&1; else echo NO_POSTQUEUE; fi',
      ]),
    ).toBe(false);
    expect(commandRequiresExecute(['true'])).toBe(false);
    expect(commandRequiresExecute(['dig', '+short', 'A', 'example.com'])).toBe(false);
    expect(commandRequiresExecute(['redis-cli', 'INFO'])).toBe(false);
    expect(commandRequiresExecute(['redis-cli', 'GET', 'k'])).toBe(false);
    expect(commandRequiresExecute(['redis-cli', 'KEYS', '*'])).toBe(false);
    expect(commandRequiresExecute(['redis-cli', 'SET', 'k', 'v'])).toBe(true);
    expect(commandRequiresExecute(['mysql', '-N', '-e', 'SHOW DATABASES'])).toBe(false);
    expect(commandRequiresExecute(['mariadb', '-N', '-e', 'SHOW DATABASES'])).toBe(false);
    expect(
      commandRequiresExecute(['bash', '-c', 'mariadb -N -e "SHOW DATABASES" 2>/dev/null || true']),
    ).toBe(false);
    expect(commandRequiresExecute(['mysql', '-e', 'DROP DATABASE app'])).toBe(true);
    expect(commandRequiresExecute(['mariadb', '-e', 'CREATE DATABASE x'])).toBe(true);
    // readiness inventory probes
    expect(commandRequiresExecute(['php', '-v'])).toBe(false);
    expect(commandRequiresExecute(['node', '-v'])).toBe(false);
    expect(commandRequiresExecute(['php', '-r', 'evil()'])).toBe(true);
    expect(commandRequiresExecute(['fail2ban-client', 'status'])).toBe(false);
    expect(commandRequiresExecute(['fail2ban-client', 'status', 'sshd'])).toBe(false);
    expect(commandRequiresExecute(['fail2ban-client', 'set', 'sshd', 'banip', '1.2.3.4'])).toBe(
      true,
    );
    expect(commandRequiresExecute(['ufw', 'status'])).toBe(false);
    expect(commandRequiresExecute(['ufw', 'status', 'numbered'])).toBe(false);
    expect(commandRequiresExecute(['ufw', 'deny', 'from', '1.2.3.4'])).toBe(true);
    expect(commandRequiresExecute(['git', '-C', '/app', 'status', '--porcelain'])).toBe(false);
    expect(commandRequiresExecute(['git', '-C', '/app', 'log', '-n10'])).toBe(false);
    expect(commandRequiresExecute(['git', '-C', '/app', 'remote', 'get-url', 'origin'])).toBe(
      false,
    );
    expect(commandRequiresExecute(['git', '-C', '/app', 'fetch', 'origin'])).toBe(true);
    expect(commandRequiresExecute(['git', 'clone', 'https://x', '/app'])).toBe(true);
    expect(commandRequiresExecute(['git', '-C', '/app', 'reset', '--hard'])).toBe(true);
    expect(commandRequiresExecute(['ssh-keyscan', '-T', '5', 'github.com'])).toBe(false);
    expect(commandRequiresExecute(['crontab', '-l'])).toBe(false);
    expect(commandRequiresExecute(['crontab', '-u', 'www-data', '-l'])).toBe(false);
    expect(commandRequiresExecute(['bash', '-c', 'crontab -l'])).toBe(false);
    expect(commandRequiresExecute(['bash', '-c', 'crontab -u ysk -l'])).toBe(false);
    expect(commandRequiresExecute(['crontab', '/tmp/ysk.crontab'])).toBe(true);
    expect(commandRequiresExecute(['crontab', '-r'])).toBe(true);
    expect(commandRequiresExecute(['bash', '-c', 'crontab /tmp/ysk.crontab'])).toBe(true);
  });
});
