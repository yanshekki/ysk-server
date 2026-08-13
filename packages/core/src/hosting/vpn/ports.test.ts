import { describe, expect, it } from 'vitest';
import {
  coerceVpnListenPort,
  isValidVpnPort,
  parseVpnListenPort,
} from './ports.js';

describe('vpn listen port', () => {
  it('accepts only integers 1–65535', () => {
    expect(isValidVpnPort(8388)).toBe(true);
    expect(isValidVpnPort(0)).toBe(false);
    expect(isValidVpnPort(65536)).toBe(false);
    expect(parseVpnListenPort('8388; rm -rf /')).toBeNull();
    expect(parseVpnListenPort('1194')).toBe(1194);
    expect(coerceVpnListenPort('nope', 8388)).toBe(8388);
    expect(coerceVpnListenPort(443, 1194)).toBe(443);
  });
});
