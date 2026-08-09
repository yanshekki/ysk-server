import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cli = join(__dirname, '../dist/cli.js');

function runHelp(args: string[]): string {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, YSK_LOCALE: 'en' },
  });
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
}

describe('CLI discoverable help', () => {
  it('top-level help lists core commands', () => {
    const out = runHelp(['--help']);
    expect(out.length).toBeGreaterThan(200);
    expect(out.toLowerCase()).toMatch(/setup|serve|projects|files|email|readiness|health/);
  });

  it('files usage mentions webdav and shares', () => {
    const out = runHelp(['files']);
    expect(out.toLowerCase()).toMatch(/webdav/);
    expect(out.toLowerCase()).toMatch(/share/);
  });
});
