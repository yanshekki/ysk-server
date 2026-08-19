import { describe, expect, it } from 'vitest';
import { lookupDns } from './dns-lookup.js';

describe('dns-lookup', () => {
  it('rejects empty name', async () => {
    const r = await lookupDns({ name: '  ' });
    expect(r.ok).toBe(false);
    expect(r.method).toBe('none');
    expect(r.notes.some((n) => /名稱|name/i.test(n))).toBe(true);
  });

  it('does not treat system resolver as @server when dig is missing', async () => {
    const r = await lookupDns({
      host: {
        runCommand: async (argv: string[]) => ({
          stdout: /command -v\s+dig/.test(argv.join(' ')) ? '' : 'YSK_NO_DIG',
          stderr: '',
          exitCode: 1,
          argv,
          dryRun: false,
        }),
      } as never,
      name: 'example.com',
      server: '127.0.0.1',
    });
    expect(r.ok).toBe(false);
    expect(r.method).toBe('none');
    expect(r.answers).toEqual([]);
    expect(r.notes.join(' ')).not.toMatch(/NXDOMAIN/i);
    expect(r.notes.join(' ')).toMatch(/dig|未安裝|not installed/i);
  });

  it('looks up a public name via node-dns (no host)', async () => {
    const r = await lookupDns({ name: 'localhost', type: 'A' });
    // localhost may resolve to 127.0.0.1; network-independent enough for CI
    expect(r.name).toBe('localhost');
    expect(r.type).toBe('A');
    expect(r.method === 'node-dns' || r.method === 'dig').toBe(true);
    expect(Array.isArray(r.answers)).toBe(true);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
