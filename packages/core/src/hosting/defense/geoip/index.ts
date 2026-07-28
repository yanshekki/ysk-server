export * from './types.js';
export * from './providers.js';
export * from './downloader.js';
export * from './lookup.js';
export * from './policy.js';
export * from './nginx-geo.js';

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

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export async function getGeoipStatus(
  dataDir: string,
  db: JsonStore,
): Promise<GeoipStatus> {
  const meta = loadGeoipMeta(dataDir);
  const listed = listGeoipSourceStatus(dataDir);
  const policy = loadIpAccessPolicy(db, dataDir);
  const ready = listed.sources.some((s) => s.present);
  let stale = false;
  if (meta?.lastSuccessAt) {
    stale = Date.now() - new Date(meta.lastSuccessAt).getTime() > STALE_MS;
  } else if (ready) {
    // present but never tracked — check mtime
    const mt = listed.sources.find((s) => s.mtime)?.mtime;
    if (mt) stale = Date.now() - new Date(mt).getTime() > STALE_MS;
    else stale = true;
  }

  const notes: string[] = [];
  if (!ready) notes.push('尚未有本地 GeoIP 庫 — 請更新');
  if (stale) notes.push('資料庫可能過舊（>7 日）— 建議立即更新');
  if (policy.enabled) {
    notes.push(
      `政策已啟用：${policy.mode} · 國 ${policy.countries.length} · 洲 ${policy.continents.length} · ASN ${policy.asns.length}`,
    );
  } else {
    notes.push('IP 准入政策未啟用（只影響查詢／enrich）');
  }
  notes.push('地區 Phase1 = 大陸（continent），非省市');
  notes.push('供應商 = ASN（自治系統），非消費品牌名');

  return {
    provider: listed.provider,
    dir: geoipDir(dataDir),
    ready,
    stale,
    meta,
    sources: listed.sources.map(({ attribution: _a, ...s }) => s),
    attribution: listed.sources.map((s) => s.attribution).filter(Boolean) as string[],
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
  // status needs db — caller can pass; here we only return download notes
  return {
    ok: r.ok,
    notes: r.notes,
    status: {
      provider: r.meta.provider,
      dir: geoipDir(dataDir),
      ready: r.meta.files.some((f) => f.ok) || r.ok,
      stale: false,
      meta: r.meta,
      sources: [],
      attribution: r.meta.attribution ? [r.meta.attribution] : [],
      policy: {
        enabled: false,
        mode: 'deny_list',
        countries: [],
        continents: [],
        asns: [],
        enforce: { autoBan: true, nginx: true, ufw: false },
        autoUpdate: true,
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
      notes: ['nginx 執行層已關閉（enforce.nginx=false）'],
    };
  }
  return writeNginxGeoConf(dataDir, policy);
}

export function geoDbFileStats(dataDir: string): Array<{ name: string; bytes: number; mtime: string }> {
  const dir = geoipDir(dataDir);
  const names = ['ipinfo_lite.mmdb', 'user-country.mmdb', 'origin-asn.mmdb'];
  const out: Array<{ name: string; bytes: number; mtime: string }> = [];
  for (const name of names) {
    const p = `${dir}/${name}`;
    if (!existsSync(p)) continue;
    const st = statSync(p);
    out.push({ name, bytes: st.size, mtime: st.mtime.toISOString() });
  }
  return out;
}
