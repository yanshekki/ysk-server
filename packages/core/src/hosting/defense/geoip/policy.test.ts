import { describe, expect, it } from 'vitest';
import { evaluateIpAccess, sanitizePolicy } from './policy.js';
import type { GeoLookupResult } from './types.js';

const baseLookup = (over: Partial<GeoLookupResult> = {}): GeoLookupResult => ({
  ip: '1.2.3.4',
  ok: true,
  country: 'CN',
  continent: 'AS',
  regionCode: 'GD',
  regionName: 'Guangdong',
  regionKey: 'CN-GD',
  city: 'Guangzhou',
  cityKey: 'CN|Guangzhou',
  asn: 'AS4134',
  asName: 'Chinanet',
  notes: [],
  ...over,
});

describe('evaluateIpAccess', () => {
  it('respects whitelist and disabled policy', () => {
    const policy = sanitizePolicy({
      enabled: true,
      mode: 'deny_list',
      countries: ['CN'],
    });
    expect(
      evaluateIpAccess(baseLookup(), policy, { whitelisted: true }).blocked,
    ).toBe(false);
    expect(
      evaluateIpAccess(baseLookup(), { ...policy, enabled: false }).blocked,
    ).toBe(false);
  });

  it('deny_list blocks matching country/asn/continent', () => {
    const policy = sanitizePolicy({
      enabled: true,
      mode: 'deny_list',
      countries: ['cn'],
      asns: ['4134'],
      continents: ['as'],
    });
    const r = evaluateIpAccess(baseLookup(), policy);
    expect(r.blocked).toBe(true);
    expect(r.matched.some((m) => m.startsWith('country:'))).toBe(true);
    expect(r.matched.some((m) => m.startsWith('asn:'))).toBe(true);
  });

  it('deny_list blocks region', () => {
    const policy = sanitizePolicy({
      enabled: true,
      mode: 'deny_list',
      regions: ['CN-GD'],
    });
    const r = evaluateIpAccess(baseLookup(), policy);
    expect(r.blocked).toBe(true);
    expect(r.matched).toContain('region:CN-GD');
  });

  it('city only blocks when cityPolicyEnabled', () => {
    const off = sanitizePolicy({
      enabled: true,
      mode: 'deny_list',
      cities: ['CN|Guangzhou'],
      cityPolicyEnabled: false,
    });
    expect(evaluateIpAccess(baseLookup(), off).blocked).toBe(false);

    const on = sanitizePolicy({
      enabled: true,
      mode: 'deny_list',
      cities: ['CN|Guangzhou'],
      cityPolicyEnabled: true,
    });
    const r = evaluateIpAccess(baseLookup(), on);
    expect(r.blocked).toBe(true);
    expect(r.matched.some((m) => m.startsWith('city:'))).toBe(true);
  });

  it('deny_list allows non-matching', () => {
    const policy = sanitizePolicy({
      enabled: true,
      mode: 'deny_list',
      countries: ['RU'],
    });
    expect(evaluateIpAccess(baseLookup(), policy).blocked).toBe(false);
  });

  it('allow_list blocks miss and unknown', () => {
    const policy = sanitizePolicy({
      enabled: true,
      mode: 'allow_list',
      countries: ['HK', 'TW'],
    });
    expect(evaluateIpAccess(baseLookup(), policy).blocked).toBe(true);
    expect(
      evaluateIpAccess(baseLookup({ country: 'HK', continent: 'AS', asn: 'AS1' }), policy)
        .blocked,
    ).toBe(false);
    expect(
      evaluateIpAccess(
        baseLookup({
          country: undefined,
          continent: undefined,
          asn: undefined,
          regionKey: undefined,
          cityKey: undefined,
        }),
        policy,
      ).blocked,
    ).toBe(true);
  });
});
