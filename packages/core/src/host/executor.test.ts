import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  LocalHostExecutor,
  commandRequiresExecute,
  pathUnderRoot,
} from './executor.js';
import { YskError } from '@ysk/shared';

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
    expect(commandRequiresExecute(['true'])).toBe(false);
    // readiness inventory probes
    expect(commandRequiresExecute(['php', '-v'])).toBe(false);
    expect(commandRequiresExecute(['node', '-v'])).toBe(false);
    expect(commandRequiresExecute(['php', '-r', 'evil()'])).toBe(true);
  });
});
