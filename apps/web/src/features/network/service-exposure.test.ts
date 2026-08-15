import { describe, expect, it } from 'vitest';
import { isFirewallEnforcing } from './service-exposure';

describe('isFirewallEnforcing', () => {
  it('treats only exact active as enforcing', () => {
    expect(isFirewallEnforcing('active')).toBe(true);
    expect(isFirewallEnforcing('Active')).toBe(true);
    expect(isFirewallEnforcing(' inactive ')).toBe(false);
    expect(isFirewallEnforcing('inactive')).toBe(false);
    expect(isFirewallEnforcing('unknown')).toBe(false);
    expect(isFirewallEnforcing(undefined)).toBe(false);
    expect(isFirewallEnforcing('active', false)).toBe(false);
  });
});
