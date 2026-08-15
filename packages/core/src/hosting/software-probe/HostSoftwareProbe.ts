/**
 * HostSoftwareProbe — single class for:
 *   presence (is installed)
 *   version
 *   upgrade
 *
 * Callers must not re-implement command -v / flavor for product software.
 */

import type { HostExecutor } from '../../host/executor.js';
import {
  binPresent,
  resolveBin,
  unitIsActive,
  unitIsEnabled,
} from './resolve-bin.js';
import {
  ENGINE_TO_CLIENT_ID,
  ENGINE_TO_SERVER_ID,
  getProbeEntry,
  listProbeIds,
} from './registry.js';
import type {
  SoftwarePresence,
  SoftwareProbeId,
  SoftwareUpgradeInfo,
  SoftwareVersionInfo,
} from './types.js';

export type SqlServerFlavor = 'mysql' | 'mariadb' | 'none';

export class HostSoftwareProbe {
  constructor(private readonly host: HostExecutor) {}

  /** Low-level bin resolve — same PATH rules for all product code */
  resolveBin(bin: string): Promise<string> {
    return resolveBin(this.host, bin);
  }

  binPresent(bin: string): Promise<boolean> {
    return binPresent(this.host, bin);
  }

  /**
   * Detect which SQL server flavor owns the host (exclusive).
   * MariaDB wins if mariadbd or mariadb-server package present.
   */
  async detectSqlFlavor(): Promise<SqlServerFlavor> {
    if (await binPresent(this.host, 'mariadbd')) return 'mariadb';
    const pkg = await this.host.runCommand(
      [
        'bash',
        '-c',
        "dpkg -l 2>/dev/null | awk '/^ii/ && /mariadb-server/ {print \"mariadb\"; exit} /^ii/ && /mysql-server/ {print \"mysql\"; exit}'",
      ],
      { timeoutMs: 10_000 },
    );
    const line = pkg.stdout.trim();
    if (line === 'mariadb' || line === 'mysql') return line;
    // mysqld alone may be Oracle MySQL; if mysql --version says MariaDB treat as mariadb
    if (await binPresent(this.host, 'mysqld')) {
      const v = await this.host.runCommand(
        ['bash', '-c', 'mysql --version 2>/dev/null || mysqld --version 2>/dev/null || true'],
        { timeoutMs: 5_000 },
      );
      if (/mariadb/i.test(v.stdout)) return 'mariadb';
      return 'mysql';
    }
    return 'none';
  }

  async isInstalled(id: SoftwareProbeId): Promise<boolean> {
    const p = await this.presence(id);
    return p.installed;
  }

  async presence(id: SoftwareProbeId): Promise<SoftwarePresence> {
    const entry = getProbeEntry(id);
    const notes: string[] = [];
    if (!entry) {
      return {
        id,
        installed: false,
        resolvedBins: [],
        missingBins: [],
        notes: [`unknown software id: ${id}`],
      };
    }

    const resolvedBins: string[] = [];
    const missingBins: string[] = [];
    for (const b of entry.bins) {
      const path = await resolveBin(this.host, b);
      if (path) resolvedBins.push(path);
      else missingBins.push(b);
    }

    let installed = entry.bins.length === 0 ? false : resolvedBins.length > 0;

    // Exclusive flavor for MySQL / MariaDB servers
    let blockedByExclusive: string | undefined;
    if (entry.requiresExclusiveFlavor || entry.exclusiveWith?.length) {
      const flavor = await this.detectSqlFlavor();
      if (id === 'mysql-server') {
        if (flavor === 'mariadb') {
          installed = false;
          blockedByExclusive = 'mariadb-server';
          notes.push('host SQL flavor is MariaDB; Oracle MySQL server not installed');
        } else if (flavor === 'mysql') {
          installed = true;
        } else {
          installed = resolvedBins.length > 0 && !(await binPresent(this.host, 'mariadbd'));
        }
      } else if (id === 'mariadb-server') {
        if (flavor === 'mysql') {
          installed = false;
          blockedByExclusive = 'mysql-server';
          notes.push('host SQL flavor is Oracle MySQL; MariaDB server not installed');
        } else if (flavor === 'mariadb') {
          installed = true;
        } else {
          installed = (await binPresent(this.host, 'mariadbd')) || resolvedBins.length > 0;
        }
      }
    }

    const units: SoftwarePresence['units'] = [];
    for (const u of entry.units ?? []) {
      try {
        const active = await unitIsActive(this.host, u);
        const enabled = await unitIsEnabled(this.host, u);
        units.push({ name: u, active, enabled });
      } catch {
        units.push({ name: u, active: 'unknown', enabled: 'unknown' });
      }
    }
    if (!installed && id === 'postgresql' && units.some((u) => u.active === 'active')) {
      installed = true;
      notes.push('postgresql unit is active; server binary may live under /usr/lib/postgresql/*/bin');
    }

    // Optional: check primary dpkg package present
    let packagesPresent: string[] | undefined;
    if (entry.dpkgPackage) {
      try {
        const r = await this.host.runCommand(
          [
            'bash',
            '-c',
            `dpkg-query -W -f='\${Status}' ${JSON.stringify(entry.dpkgPackage)} 2>/dev/null || true`,
          ],
          { timeoutMs: 5_000 },
        );
        if (/install ok installed/i.test(r.stdout)) {
          packagesPresent = [entry.dpkgPackage];
        }
      } catch {
        /* ignore dpkg probe errors */
      }
    }

    return {
      id,
      installed,
      resolvedBins,
      missingBins: installed ? [] : missingBins,
      blockedByExclusive,
      packagesPresent,
      units: units.length ? units : undefined,
      notes,
    };
  }

  async version(id: SoftwareProbeId): Promise<SoftwareVersionInfo> {
    const pres = await this.presence(id);
    const entry = getProbeEntry(id);
    const notes = [...pres.notes];
    if (!pres.installed) {
      return {
        id,
        installed: false,
        source: 'unknown',
        notes: notes.length ? notes : ['not installed'],
      };
    }
    if (!entry) {
      return { id, installed: false, source: 'unknown', notes: ['unknown id'] };
    }

    // CLI version first (may print to stderr, e.g. nginx -v)
    if (entry.versionCommand?.length) {
      const argv = entry.versionCommand;
      const r = await this.host.runCommand(
        ['bash', '-c', `${argv.map((a) => JSON.stringify(a)).join(' ')} 2>&1 || true`],
        { timeoutMs: 8_000 },
      );
      const raw = (r.stdout || r.stderr || '').trim();
      // Ignore empty / pure whitespace; dpkg fallback otherwise
      if (raw && !/^dpkg-query/i.test(raw)) {
        const version = raw.split('\n')[0]!.slice(0, 160);
        return { id, installed: true, version, raw, source: 'cli', notes };
      }
    }

    // dpkg fallback
    if (entry.dpkgPackage) {
      const r = await this.host.runCommand(
        [
          'bash',
          '-c',
          `dpkg-query -W -f='\${Version}' ${JSON.stringify(entry.dpkgPackage)} 2>/dev/null || true`,
        ],
        { timeoutMs: 5_000 },
      );
      const ver = r.stdout.trim();
      if (ver) {
        return {
          id,
          installed: true,
          version: ver,
          raw: ver,
          source: 'dpkg',
          notes,
        };
      }
    }

    return { id, installed: true, source: 'unknown', notes: [...notes, 'version unavailable'] };
  }

  async upgrade(id: SoftwareProbeId): Promise<SoftwareUpgradeInfo> {
    const entry = getProbeEntry(id);
    const packageName = entry?.dpkgPackage || entry?.aptPackages[0] || id;
    const pres = await this.presence(id);
    if (!entry) {
      return {
        id,
        packageName,
        installed: false,
        upgradable: false,
        source: 'none',
        notes: ['unknown id'],
      };
    }
    if (!pres.installed) {
      return {
        id,
        packageName,
        installed: false,
        upgradable: false,
        source: 'none',
        notes: ['not installed'],
      };
    }

    // apt-cache policy: Installed: / Candidate:
    const r = await this.host.runCommand(
      [
        'bash',
        '-c',
        `apt-cache policy ${JSON.stringify(packageName)} 2>/dev/null | head -n 20 || true`,
      ],
      { timeoutMs: 15_000 },
    );
    const text = r.stdout || '';
    const instM = text.match(/Installed:\s*(\S+)/);
    const candM = text.match(/Candidate:\s*(\S+)/);
    const currentVersion =
      instM?.[1] && instM[1] !== '(none)' ? instM[1] : undefined;
    const candidateVersion =
      candM?.[1] && candM[1] !== '(none)' ? candM[1] : undefined;
    const upgradable = Boolean(
      currentVersion &&
        candidateVersion &&
        currentVersion !== candidateVersion &&
        candidateVersion !== '(none)',
    );

    return {
      id,
      packageName,
      installed: true,
      currentVersion,
      candidateVersion,
      upgradable,
      source: text.trim() ? 'apt' : 'none',
      notes: upgradable
        ? [`${packageName}: ${currentVersion} → ${candidateVersion}`]
        : ['no upgrade candidate'],
    };
  }

  /**
   * Batch catalog upgrade probe (one host round-trip when possible).
   * Falls back to sequential upgrade() when batch output is unusable (tests / broken apt).
   */
  async upgrades(ids?: SoftwareProbeId[]): Promise<SoftwareUpgradeInfo[]> {
    const list = ids?.length ? ids : listProbeIds();
    const batch = await this.upgradesBatch(list);
    if (batch) return batch;
    const out: SoftwareUpgradeInfo[] = [];
    for (const id of list) {
      out.push(await this.upgrade(id));
    }
    return out;
  }

  /**
   * Single bash loop over apt-cache policy for all probe packages.
   * Returns null when stdout cannot be mapped (caller should sequential-fallback).
   */
  private async upgradesBatch(
    list: SoftwareProbeId[],
  ): Promise<SoftwareUpgradeInfo[] | null> {
    const specs = list.map((id) => {
      const entry = getProbeEntry(id);
      const packageName = entry?.dpkgPackage || entry?.aptPackages[0] || id;
      return { id, packageName, entry };
    });
    const packages = [
      ...new Set(
        specs
          .map((s) => s.packageName)
          .filter((p) => /^[a-zA-Z0-9.+_-]+$/.test(p)),
      ),
    ];
    if (!packages.length) return [];

    const pkgArgs = packages.map((p) => JSON.stringify(p)).join(' ');
    const script = `
set +e
export LANG=C
for p in ${pkgArgs}; do
  out=$(apt-cache policy "$p" 2>/dev/null | head -n 16)
  inst=$(printf '%s\\n' "$out" | awk '/^[[:space:]]*Installed:/{print $2; exit}')
  cand=$(printf '%s\\n' "$out" | awk '/^[[:space:]]*Candidate:/{print $2; exit}')
  [ -z "$inst" ] && inst="(none)"
  [ -z "$cand" ] && cand="(none)"
  printf '%s\\t%s\\t%s\\n' "$p" "$inst" "$cand"
done
`.trim();

    const r = await this.host.runCommand(['bash', '-c', script], {
      timeoutMs: 45_000,
    });
    const byPkg = new Map<
      string,
      { current?: string; candidate?: string; source: 'apt' | 'none' }
    >();
    let parsed = 0;
    for (const line of (r.stdout || '').trim().split('\n')) {
      if (!line.includes('\t')) continue;
      const [name, inst, cand] = line.split('\t');
      if (!name) continue;
      parsed += 1;
      const current =
        inst && inst !== '(none)' ? inst.trim() : undefined;
      const candidate =
        cand && cand !== '(none)' ? cand.trim() : undefined;
      byPkg.set(name, {
        current,
        candidate,
        source: r.stdout?.trim() ? 'apt' : 'none',
      });
    }
    // Need a usable row per requested package; otherwise sequential fallback
    if (parsed === 0 || packages.some((p) => !byPkg.has(p))) return null;

    return specs.map(({ id, packageName, entry }) => {
      if (!entry) {
        return {
          id,
          packageName,
          installed: false,
          upgradable: false,
          source: 'none' as const,
          notes: ['unknown id'],
        };
      }
      const row = byPkg.get(packageName);
      if (!row?.current) {
        return {
          id,
          packageName,
          installed: false,
          upgradable: false,
          source: 'none' as const,
          notes: ['not installed'],
        };
      }
      const upgradable = Boolean(
        row.candidate &&
          row.current !== row.candidate &&
          row.candidate !== '(none)',
      );
      return {
        id,
        packageName,
        installed: true,
        currentVersion: row.current,
        candidateVersion: row.candidate,
        upgradable,
        source: row.source,
        notes: upgradable
          ? [`${packageName}: ${row.current} → ${row.candidate}`]
          : ['no upgrade candidate'],
      };
    });
  }

  /** Convenience for service-console engines */
  async presenceForEngine(engine: string): Promise<{
    server: SoftwarePresence;
    client?: SoftwarePresence;
  }> {
    const serverId = ENGINE_TO_SERVER_ID[engine] ?? engine;
    const clientId = ENGINE_TO_CLIENT_ID[engine];
    const server = await this.presence(serverId);
    const client = clientId ? await this.presence(clientId) : undefined;
    return { server, client };
  }
}

/** Factory helper */
export function createHostSoftwareProbe(host: HostExecutor): HostSoftwareProbe {
  return new HostSoftwareProbe(host);
}
