/**
 * Package inventory — real host apt/dpkg data.
 * candidateVersion comes from apt-cache policy / apt list --upgradable, never faked to current.
 */

import type { HostExecutor } from '../host/executor.js';
import type { PackageInventoryItem } from './advisor.js';
import { adviseUpdate } from './advisor.js';
import type { UpdateItemDto } from '@ysk/shared';

export type InventoryCollectMeta = {
  /** How candidates were resolved */
  source: 'apt' | 'dpkg-only' | 'mixed';
  upgradableCount: number;
  notes: string[];
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
  const up = await host.runCommand(
    [
      'bash',
      '-c',
      // -qq quiet; allow non-zero when apt warns about auth
      `apt-get update -qq 2>/dev/null || true; apt list --upgradable -qq 2>/dev/null | head -n 200`,
    ],
    { dryRun: false, timeoutMs: 120_000 },
  );

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
      notes.push(`apt list --upgradable: ${upgradableCount} 可升級`);
    }
  } else {
    notes.push(
      up.exitCode !== 0
        ? `apt list --upgradable 不可用（exit ${up.exitCode}）；改用 apt-cache policy`
        : 'apt list --upgradable：無輸出（可能無更新或 apt 未就緒）',
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
  [ "$n" -ge 80 ] && break
done < <(dpkg-query -W -f='\${Package}\\t\${Version}\\n' 2>/dev/null | head -n 80)
`.trim();

  const pol = await host.runCommand(['bash', '-c', policyScript], {
    dryRun: false,
    timeoutMs: 90_000,
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
    notes.push(`dpkg+apt-cache policy: ${policyRows} 套件`);
  } else {
    notes.push(
      `dpkg/apt-cache policy 失敗或空白（exit ${pol.exitCode}）— 可能無 apt 或權限不足`,
    );
  }

  // —— 3) nodejs: only if deb package exists; else note runtime only (no fake apt candidate) ——
  const nodeDeb = byName.get('nodejs');
  if (!nodeDeb) {
    // Optional: show runtime as info-only when not an apt package — omit fake upgrade path
    notes.push(
      `Node 進程 ${process.version}（非 apt nodejs 套件則不列入可升級清單）`,
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

  notes.push(`真實可升級（candidate ≠ current）: ${realUpgrades}`);

  return {
    items,
    meta: { source, upgradableCount: realUpgrades, notes },
  };
}

/**
 * Produce structured update advice for inventory.
 */
export function adviseInventory(items: PackageInventoryItem[]): UpdateItemDto[] {
  return items.map((i) => adviseUpdate(i));
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
