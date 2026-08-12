import { tl } from '@ysk-server/shared';
/**
 * Best-effort nginx geoip2 snippet for managed conf.d.
 * Requires ngx_http_geoip2_module; if absent, notes explain written ≠ applied.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IpAccessPolicy } from './types.js';
import { geoipDir } from './downloader.js';

export function nginxGeoConfPath(dataDir: string): string {
  return join(dataDir, 'nginx', 'conf.d', '01-ysk-geoip.conf');
}

/**
 * Generate conf that sets variables from MMDB when geoip2 module exists.
 * Actual deny is done via map on $ysk_geo_block for server blocks that include it.
 *
 * Country/ASN allow|deny lists are encoded as maps; full IP→country still needs geoip2.
 */
export function renderNginxGeoConf(dataDir: string, policy: IpAccessPolicy): {
  path: string;
  body: string;
  notes: string[];
} {
  const dir = geoipDir(dataDir);
  const lite = join(dir, 'ipinfo_lite.mmdb');
  const country = join(dir, 'user-country.mmdb');
  const asn = join(dir, 'origin-asn.mmdb');
  const mmdb = existsSync(lite) ? lite : existsSync(country) ? country : '';
  const asnDb = existsSync(lite) ? lite : existsSync(asn) ? asn : '';

  const notes: string[] = [
    tl('notes.auto.n1566'),
    tl('notes.auto.n1122'),
  ];

  const denyCountries = policy.mode === 'deny_list' ? policy.countries : [];
  const allowCountries = policy.mode === 'allow_list' ? policy.countries : [];

  const countryMapLines =
    policy.mode === 'deny_list'
      ? denyCountries.map((c) => `    ${c} 1;`).join('\n')
      : allowCountries.length
        ? [
            '    default 1;',
            ...allowCountries.map((c) => `    ${c} 0;`),
          ].join('\n')
        : '    default 0;';

  const body = `# YSK GeoIP access — managed (do not edit by hand)
# policy enabled=${policy.enabled} mode=${policy.mode}
# updated=${policy.updatedAt ?? 'n/a'}

# geoip2 loads only if module present — nginx -t will fail otherwise; wrap carefully.
# Operators: ensure "load_module modules/ngx_http_geoip2_module.so;" in main nginx.conf when using this.

${
  mmdb
    ? `# geoip2 ${mmdb} {
#     auto_reload 24h;
#     $ysk_geo_country country iso_code;
#     $ysk_geo_continent continent code;
# }
`
    : '# (no country mmdb on disk)\n'
}

${
  asnDb && asnDb !== mmdb
    ? `# geoip2 ${asnDb} {
#     auto_reload 24h;
#     $ysk_geo_asn autonomous_system_number;
# }
`
    : ''
}

# Map country code → block flag (1 = block)
map $ysk_geo_country $ysk_geo_country_block {
${countryMapLines}
}

# Master switch
map $ysk_geo_country_block $ysk_geo_block {
    default ${policy.enabled ? '0' : '0'};
    1 ${policy.enabled ? '1' : '0'};
}

# Usage in server {}:
#   if ($ysk_geo_block) { return 403; }
# Or include a snippet after real_ip for Cloudflare.

# Policy snapshot (informational)
# countries=${policy.countries.join(',') || '-'}
# continents=${policy.continents.join(',') || '-'}
# asns=${policy.asns.join(',') || '-'}
`;

  return { path: nginxGeoConfPath(dataDir), body, notes };
}

export function writeNginxGeoConf(
  dataDir: string,
  policy: IpAccessPolicy,
): { path: string; notes: string[]; ok: boolean } {
  const confDir = join(dataDir, 'nginx', 'conf.d');
  mkdirSync(confDir, { recursive: true });
  const { path, body, notes } = renderNginxGeoConf(dataDir, policy);
  writeFileSync(path, body, 'utf8');
  notes.push(tl('notes.email.wrotePath', { path }));
  notes.push(tl('notes.auto.n0470'));
  return { path, notes, ok: true };
}
