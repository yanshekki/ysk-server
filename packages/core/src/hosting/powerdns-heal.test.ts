import { describe, expect, it } from 'vitest';
import {
  configurePdnsLocalAddressShell,
  healPowerDnsListener,
} from './powerdns-apply.js';

function host(
  run: (argv: string[]) => { exitCode: number; stdout: string; stderr?: string },
  opts?: { execute?: boolean; root?: boolean },
) {
  return {
    executeEnabled: () => opts?.execute !== false,
    isRoot: () => opts?.root !== false,
    runCommand: async (argv: string[]) => {
      const r = run(argv.map(String));
      return { ...r, stderr: r.stderr ?? '', argv, dryRun: false };
    },
  };
}

describe('powerdns heal / local-address', () => {
  it('shell configures drop-in and avoids 0.0.0.0 bind', () => {
    const s = configurePdnsLocalAddressShell();
    expect(s).toMatch(/ysk-local-address\.conf/);
    expect(s).toMatch(/local-address=\$PUB/);
    expect(s).toMatch(/systemctl start pdns/);
    expect(s).not.toMatch(/local-address=0\.0\.0\.0/);
  });

  it('heal blocked without execute', async () => {
    const r = await healPowerDnsListener({
      host: host(() => ({ exitCode: 0, stdout: '' }), { execute: false }),
    });
    expect(r.ok).toBe(false);
    expect(r.requiresExecute || r.requiresRoot).toBe(true);
  });

  it('heal success parses local address and listen', async () => {
    const r = await healPowerDnsListener({
      host: host((argv) => {
        const s = argv.join(' ');
        if (s.includes('heal') || s.includes('local-address') || s.includes('YSK_PDNS')) {
          return {
            exitCode: 0,
            stdout: 'YSK_PDNS_LOCAL_ADDRESS=84.32.34.14\nactive\nUNCONN 0 0 84.32.34.14:53\n',
          };
        }
        if (s.includes('is-active')) return { exitCode: 0, stdout: 'active\n' };
        if (s.includes('ss -ulnp')) return { exitCode: 0, stdout: 'UNCONN 0 0 84.32.34.14:53 *:*\n' };
        return { exitCode: 0, stdout: '' };
      }),
    });
    expect(r.localAddress).toBe('84.32.34.14');
    expect(r.ok).toBe(true);
    expect(r.unitActive).toBe(true);
    expect(r.listenUdp53).toBe(true);
  });
});
