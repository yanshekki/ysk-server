import { tl } from '@ysk/shared';
export * from './types.js';
export * from './providers.js';
export * from './downloader.js';
export * from './lookup.js';
export * from './policy.js';
export * from './nginx-geo.js';

import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import type { JsonStore } from '../../../db/store.js';
import {
  geoipDir,
  listGeoipSourceStatus,
  loadGeoipMeta,
  updateGeoipDatabases,
} from './downloader.js';
import { lookupIp, resetGeoipReaders } from './lookup.js';
import { loadIpAccessPolicy, saveIpAccessPolicy, evaluateIpAccess } from './policy.js';
import { writeNginxGeoConf } from './nginx-geo.js';
import { ipMatchesWhitelist } from '../auto-ban.js';
import type { GeoipStatus, IpAccessPolicy } from './types.js';
import { DEFAULT_IP_ACCESS_POLICY } from './types.js';

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export async function getGeoipStatus(
  dataDir: string,
  db: JsonStore,
): Promise<GeoipStatus> {
  const meta = loadGeoipMeta(dataDir);
  const listed = listGeoipSourceStatus(dataDir);
  const policy = loadIpAccessPolicy(db, dataDir);
  const ready = listed.sources.some((s) => s.present);
  const cityReady = existsSync(join(geoipDir(dataDir), 'dbip-city-lite.mmdb'));
  let stale = false;
  if (meta?.lastSuccessAt) {
    stale = Date.now() - new Date(meta.lastSuccessAt).getTime() > STALE_MS;
  } else if (ready) {
    const mt = listed.sources.find((s) => s.mtime)?.mtime;
    if (mt) stale = Date.now() - new Date(mt).getTime() > STALE_MS;
    else stale = true;
  }

  const notes: string[] = [];
  if (!ready) notes.push(tl('notes.auto.n0709'));
  if (stale) notes.push(tl('notes.auto.n1448'));
  if (cityReady) {
    notes.push(
      tl('notes.auto.n0581'),
    );
  } else {
    notes.push(tl('notes.auto.n0976'));
  }
  if (policy.enabled) {
    notes.push(
      tl('notes.auto.t0774', { v0: (policy.mode), v1: (policy.countries.length), v2: (policy.regions.length), v3: (policy.cities.length), v4: (policy.cityPolicyEnabled ? '' : tl('notes.tpl.cityPolicyOff')), v5: (policy.asns.length) }),
    );
  } else {
    notes.push(tl('notes.auto.n0118'));
  }
  notes.push(tl('notes.auto.n0554'));

  const attribution = [
    ...new Set(
      [
        ...listed.sources.map((s) => s.attribution).filter(Boolean),
        meta?.attribution,
      ].filter(Boolean) as string[],
    ),
  ];

  return {
    provider: listed.provider,
    dir: geoipDir(dataDir),
    ready,
    stale,
    cityReady,
    maxGranularity: cityReady ? 'city' : 'country',
    meta,
    sources: listed.sources.map(({ attribution: _a, ...s }) => s),
    attribution,
    policy,
    notes,
  };
}

export async function refreshGeoip(dataDir: string): Promise<{
  ok: boolean;
  notes: string[];
  status: GeoipStatus;
}> {
  const r = await updateGeoipDatabases(dataDir);
  resetGeoipReaders();
  const cityReady = existsSync(join(geoipDir(dataDir), 'dbip-city-lite.mmdb'));
  return {
    ok: r.ok,
    notes: r.notes,
    status: {
      provider: r.meta.provider,
      dir: geoipDir(dataDir),
      ready: r.meta.files.some((f) => f.ok) || r.ok,
      stale: false,
      cityReady,
      maxGranularity: cityReady ? 'city' : 'country',
      meta: r.meta,
      sources: [],
      attribution: r.meta.attribution ? [r.meta.attribution] : [],
      policy: {
        ...DEFAULT_IP_ACCESS_POLICY,
        countries: [],
        continents: [],
        regions: [],
        cities: [],
        asns: [],
      },
      notes: r.notes,
    },
  };
}

export async function lookupIpWithPolicy(
  dataDir: string,
  db: JsonStore,
  ip: string,
  whitelist: string[] = [],
): Promise<{
  lookup: Awaited<ReturnType<typeof lookupIp>>;
  access: ReturnType<typeof evaluateIpAccess>;
}> {
  const policy = loadIpAccessPolicy(db, dataDir);
  const lookup = await lookupIp(dataDir, ip);
  const whitelisted = ipMatchesWhitelist(ip, whitelist);
  const access = evaluateIpAccess(lookup, policy, { whitelisted });
  return { lookup, access };
}

export function updateIpAccessPolicy(
  db: JsonStore,
  dataDir: string,
  patch: Partial<IpAccessPolicy>,
): IpAccessPolicy {
  return saveIpAccessPolicy(db, dataDir, patch);
}

export function applyIpAccessNginx(
  dataDir: string,
  db: JsonStore,
): { ok: boolean; path: string; notes: string[] } {
  const policy = loadIpAccessPolicy(db, dataDir);
  if (!policy.enforce.nginx) {
    return {
      ok: true,
      path: '',
      notes: [tl('notes.auto.n0343')],
    };
  }
  return writeNginxGeoConf(dataDir, policy);
}

export function geoDbFileStats(
  dataDir: string,
): Array<{ name: string; bytes: number; mtime: string }> {
  const dir = geoipDir(dataDir);
  const names = [
    'ipinfo_lite.mmdb',
    'user-country.mmdb',
    'origin-asn.mmdb',
    'dbip-city-lite.mmdb',
  ];
  const out: Array<{ name: string; bytes: number; mtime: string }> = [];
  for (const name of names) {
    const p = `${dir}/${name}`;
    if (!existsSync(p)) continue;
    const st = statSync(p);
    out.push({ name, bytes: st.size, mtime: st.mtime.toISOString() });
  }
  return out;
}
