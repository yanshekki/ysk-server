import { describe, expect, it } from 'vitest';
import { allocateValidatorPorts, hostLoopbackPortTaken, parseSsListenPortSet } from './ports.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('validator ports', () => {
  it('does not default Aptos RPC to host 8080', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-val-ports-'));
    const ports = allocateValidatorPorts(dir, 'aptos');
    expect(ports.rpc).not.toBe(8080);
    expect(ports.rpc).toBe(18080);
  });

  it('skips host listen ports from ss', () => {
    const ss = 'LISTEN 0 4096 127.0.0.1:18080 0.0.0.0:*\nLISTEN 0 128 0.0.0.0:22 0.0.0.0:*\n';
    expect(hostLoopbackPortTaken(ss, 18080)).toBe(true);
    expect(parseSsListenPortSet(ss).has(18080)).toBe(true);
    expect(parseSsListenPortSet(ss).has(22)).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'ysk-val-ports-'));
    const ports = allocateValidatorPorts(dir, 'aptos', parseSsListenPortSet(ss));
    expect(ports.rpc).toBe(18081);
  });
});
