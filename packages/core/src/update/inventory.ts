/**
 * Package inventory collection (real host commands when available).
 */

import type { HostExecutor } from '../host/executor.js';
import type { PackageInventoryItem } from './advisor.js';
import { adviseUpdate } from './advisor.js';
import type { UpdateItemDto } from '@ysk/shared';

/**
 * Collect installed package versions via dpkg-query or fallback node version.
 */
export async function collectInventory(host: HostExecutor): Promise<PackageInventoryItem[]> {
  const items: PackageInventoryItem[] = [];

  // Always include node
  items.push({
    packageName: 'nodejs',
    currentVersion: process.version.replace(/^v/, ''),
    candidateVersion: process.version.replace(/^v/, ''),
  });

  const dpkg = await host.runCommand(
    ['bash', '-c', "dpkg-query -W -f='${Package}\\t${Version}\\n' 2>/dev/null | head -n 40"],
    { dryRun: false, timeoutMs: 15_000 },
  );
  if (dpkg.exitCode === 0 && dpkg.stdout.trim()) {
    for (const line of dpkg.stdout.trim().split('\n')) {
      const [name, ver] = line.split('\t');
      if (name && ver) {
        items.push({ packageName: name, currentVersion: ver, candidateVersion: ver });
      }
    }
  }

  return items;
}

/**
 * Produce structured update advice for inventory (candidate = current unless caller sets CVE signals).
 */
export function adviseInventory(items: PackageInventoryItem[]): UpdateItemDto[] {
  return items.map((i) => adviseUpdate(i));
}

/**
 * Query OSV.dev for a package (network). Returns CVE-like ids when available.
 */
export async function lookupOsvVulns(
  packageName: string,
  version: string,
): Promise<string[]> {
  try {
    const res = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package: { name: packageName, ecosystem: 'Debian' },
        version,
      }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { vulns?: Array<{ id?: string; severity?: Array<{ type?: string; score?: string }> }> };
    return (body.vulns ?? []).slice(0, 10).map((v) => {
      const sev = v.severity?.[0]?.score ?? '';
      return `${v.id ?? 'UNKNOWN'} ${sev}`.trim();
    });
  } catch {
    return [];
  }
}
