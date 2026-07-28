import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from './executor.js';
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
});
