import { tl } from 'ysk-server-shared';
/**
 * Package inventory — real host apt/dpkg data.
 * candidateVersion comes from apt-cache policy / apt list --upgradable, never faked to current.
 */

import type { HostExecutor } from '../host/executor.js';
import type { PackageInventoryItem } from './advisor.js';
import { adviseUpdate } from './advisor.js';
import type { UpdateItemDto } from 'ysk-server-shared';
import { HostSoftwareProbe } from '../hosting/software-probe/index.js';
import type { SoftwareUpgradeInfo } from '../hosting/software-probe/index.js';

export type InventoryCollectMeta = {
  /** How candidates were resolved */
  source: 'apt' | 'dpkg-only' | 'mixed';
  upgradableCount: number;
  notes: string[];
  /** True when apt upgradable list was capped */
  truncated?: boolean;
};

/**
 * Collect installed packages + real upgrade candidates.
 *
 * 1) `apt list --upgradable` → known upgrades (best signal)
 * 2) `dpkg-query` sample + `apt-cache policy` Candidate: for each
 * 3) Never set candidate === current unless apt says so
 */
export async function collectInventory(host: HostExecutor): Promise<{
  items: PackageInventoryItem[];
  meta: InventoryCollectMeta;
}> {
  const notes: string[] = [];
  const byName = new Map<string, PackageInventoryItem>();

  // —— 1) Upgradable list (authoritative upgrade set) ——
  // apt-get update mutates indexes and needs YSK_EXECUTE; apt list is read-only and works without it.
  const refreshIndexes = host.executeEnabled();
  const upScript = refreshIndexes
    ? `apt-get update -qq 2>/dev/null || true; apt list --upgradable -qq 2>/dev/null | head -n 2000`
    : `apt list --upgradable -qq 2>/dev/null | head -n 2000`;
  if (!refreshIndexes) {
    notes.push(tl('notes.auto.n1610'));
  }
  const up = await host.runCommand(['bash', '-c', upScript], {
    dryRun: false,
    // Keep read-only apt list bounded so CI/unit paths cannot hang 60s+ per call.
    timeoutMs: refreshIndexes ? 120_000 : 20_000,
  });

  let upgradableCount = 0;
  if (up.stdout.trim()) {
    for (const line of up.stdout.trim().split('\n')) {
      // e.g. openssl/jammy-updates 3.0.2-0ubuntu1.18 amd64 [upgradable from: 3.0.2-0ubuntu1.12]
      const m = line.match(
        /^([a-zA-Z0-9.+_-]+)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from:\s*([^\]]+)\]/,
      );
      if (!m) continue;
      const packageName = m[1]!;
      const candidateVersion = m[2]!;
      const currentVersion = m[3]!.trim();
      if (!packageName || !candidateVersion || !currentVersion) continue;
      upgradableCount += 1;
      byName.set(packageName, {
        packageName,
        currentVersion,
        candidateVersion,
        hasSecurityFix: /security/i.test(line),
      });
    }
    if (upgradableCount > 0) {
      notes.push(tl('notes.auto.t0463', { v0: (upgradableCount) }));
    }
    if (upgradableCount >= 2000) {
      notes.push(tl('notes.auto.n1610'));
    }
  } else {
    notes.push(
      up.exitCode !== 0
        ? tl('notes.auto.t0464', { v0: (up.exitCode) })
        : tl('notes.auto.n0226'),
    );
  }

  // —— 2) dpkg installed sample + apt-cache policy Candidate ——
  // Single bash loop to avoid N round-trips
  const policyScript = `
set -e
export LANG=C
n=0
while IFS=$'\\t' read -r name ver; do
  [ -z "$name" ] && continue
  [ "$name" = "nodejs" ] && continue
  cand=$(apt-cache policy "$name" 2>/dev/null | awk '/^  Candidate:/{print $2; exit}')
  if [ -z "$cand" ] || [ "$cand" = "(none)" ]; then
    cand="$ver"
  fi
  printf '%s\\t%s\\t%s\\n' "$name" "$ver" "$cand"
  n=$((n+1))
  [ "$n" -ge 400 ] && break
done < <(dpkg-query -W -f='\${Package}\\t\${Version}\\n' 2>/dev/null | head -n 400)
`.trim();

  const pol = await host.runCommand(['bash', '-c', policyScript], {
    dryRun: false,
    timeoutMs: 25_000,
  });

  let policyRows = 0;
  if (pol.exitCode === 0 && pol.stdout.trim()) {
    for (const line of pol.stdout.trim().split('\n')) {
      const [name, ver, cand] = line.split('\t');
      if (!name || !ver) continue;
      policyRows += 1;
      const candidateVersion =
        cand && cand !== '(none)' && cand.trim() ? cand.trim() : ver;
      const existing = byName.get(name);
      if (existing) {
        // Prefer upgradable parse for candidate; refresh current from dpkg if present
        existing.currentVersion = ver;
        if (
          !existing.candidateVersion ||
          existing.candidateVersion === existing.currentVersion
        ) {
          existing.candidateVersion = candidateVersion;
        }
      } else {
        byName.set(name, {
          packageName: name,
          currentVersion: ver,
          candidateVersion,
        });
      }
    }
    notes.push(tl('notes.auto.t0465', { v0: (policyRows) }));
  } else {
    notes.push(
      tl('notes.auto.t0466', { v0: (pol.exitCode) }),
    );
  }

  // —— 3) nodejs: only if deb package exists; else note runtime only (no fake apt candidate) ——
  const nodeDeb = byName.get('nodejs');
  if (!nodeDeb) {
    // Optional: show runtime as info-only when not an apt package — omit fake upgrade path
    notes.push(
      tl('notes.auto.t0467', { v0: (process.version) }),
    );
  }

  const items = [...byName.values()].sort((a, b) => {
    const au = a.candidateVersion !== a.currentVersion ? 0 : 1;
    const bu = b.candidateVersion !== b.currentVersion ? 0 : 1;
    if (au !== bu) return au - bu;
    return a.packageName.localeCompare(b.packageName);
  });

  const realUpgrades = items.filter(
    (i) => i.candidateVersion && i.candidateVersion !== i.currentVersion,
  ).length;

  let source: InventoryCollectMeta['source'] = 'mixed';
  if (upgradableCount > 0 && policyRows > 0) source = 'mixed';
  else if (upgradableCount > 0) source = 'apt';
  else if (policyRows > 0) source = 'dpkg-only';
  else source = 'dpkg-only';

  notes.push(tl('notes.auto.t0468', { v0: (realUpgrades) }));

  return {
    items,
    meta: {
      source,
      upgradableCount: realUpgrades,
      notes,
      truncated: upgradableCount >= 2000,
    },
  };
}

/**
 * Produce structured update advice for inventory.
 */
export function adviseInventory(items: PackageInventoryItem[]): UpdateItemDto[] {
  return items.map((i) => adviseUpdate(i));
}

/**
 * Catalog software upgrades via HostSoftwareProbe.upgrade (unified standard).
 * Complements full-host collectInventory with product-scoped package status.
 */
export async function collectCatalogSoftwareUpgrades(
  host: HostExecutor,
): Promise<SoftwareUpgradeInfo[]> {
  const probe = new HostSoftwareProbe(host);
  // Only packages that are installed and may have apt candidates
  const all = await probe.upgrades();
  return all.filter((u) => u.installed);
}

/**
 * Query OSV.dev for a package (network). Returns CVE-like ids when available.
 * Does not invent candidate versions — only annotates installed version vulns.
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
      // Network-bound helper used by HTTP tests — never hang the suite.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      vulns?: Array<{
        id?: string;
        severity?: Array<{ type?: string; score?: string }>;
      }>;
    };
    return (body.vulns ?? []).slice(0, 10).map((v) => {
      const sev = v.severity?.[0]?.score ?? '';
      return `${v.id ?? 'UNKNOWN'} ${sev}`.trim();
    });
  } catch {
    return [];
  }
}
