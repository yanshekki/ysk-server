/**
 * Unified update hub — one scan for panel + catalog services + runtimes + remaining apt.
 */

import { SOFTWARE_CATALOG, type SoftwareSpec } from '../hosting/software-catalog.js';
import { resolveSoftwareTitle } from '../hosting/software-catalog.js';
import { HostSoftwareProbe } from '../hosting/software-probe/index.js';
import { resolveSoftwareVersionStatus } from '../hosting/version-discovery.js';
import type { HostExecutor } from '../host/executor.js';
import { adviseUpdate } from './advisor.js';
import { collectInventory, type InventoryCollectMeta } from './inventory.js';
import { CANONICAL_NPM_PACKAGE, checkSelfUpdate } from './self-update-apply.js';

export type UpdateHubGroup = 'panel' | 'service' | 'runtime' | 'os';
export type UpdateHubKind = 'npm-panel' | 'apt' | 'runtime' | 'npm-global';
export type UpdateApplyPath = 'apt' | 'runtime' | 'panel' | 'none';

export type UpdateHubEntry = {
  id: string;
  title: string;
  group: UpdateHubGroup;
  kind: UpdateHubKind;
  softwareId?: string;
  packageName?: string;
  currentVersion?: string;
  latestVersion?: string;
  installed: boolean;
  upgradable: boolean;
  href: string;
  applyPath: UpdateApplyPath;
  risk?: string;
  cves?: string[];
  requiresApproval?: boolean;
  summary?: string;
  notes: string[];
};

const FEATURE_HREF: Record<string, string> = {
  ftp: '/ftp',
  nginx: '/nginx',
  apache: '/apache',
  ssl: '/ssl',
  mysql: '/databases/mysql',
  mariadb: '/databases/mariadb',
  postgres: '/databases/postgres',
  redis: '/databases/redis',
  firewall: '/protection',
  fail2ban: '/protection',
  dns: '/dns',
  email: '/email',
  node: '/runtimes/node',
  php: '/runtimes/php',
  python: '/runtimes/python',
  go: '/runtimes/go',
  rust: '/runtimes/rust',
  java: '/runtimes/java',
  kotlin: '/runtimes/kotlin',
  bun: '/runtimes/bun',
  hostBrowse: '/host-browse',
  vpn: '/vpn',
  wireguard: '/vpn',
  openvpn: '/vpn',
  outline: '/vpn',
  vnc: '/vnc',
  tigervnc: '/vnc',
  novnc: '/vnc',
  git: '/system',
};

function hrefFor(spec: SoftwareSpec): string {
  for (const f of spec.features) {
    if (f !== 'all' && FEATURE_HREF[f]) return FEATURE_HREF[f]!;
  }
  return '/updates';
}

function catalogKind(spec: SoftwareSpec): {
  group: UpdateHubGroup;
  kind: UpdateHubKind;
  applyPath: UpdateApplyPath;
} {
  if (spec.installer === 'npm-global') {
    return { group: 'runtime', kind: 'npm-global', applyPath: 'runtime' };
  }
  if (spec.installer?.startsWith('runtime-')) {
    return { group: 'runtime', kind: 'runtime', applyPath: 'runtime' };
  }
  return { group: 'service', kind: 'apt', applyPath: 'apt' };
}

function catalogAptNames(): Set<string> {
  const s = new Set<string>();
  for (const spec of SOFTWARE_CATALOG) {
    if (spec.installer?.startsWith('runtime-') || spec.installer === 'npm-global') continue;
    for (const p of spec.aptPackages) s.add(p);
  }
  return s;
}

export async function collectUpdateHub(input: {
  host: HostExecutor;
  dataDir: string;
  currentPanelVersion: string;
  refreshRuntimes?: boolean;
}): Promise<{
  entries: UpdateHubEntry[];
  inventoryMeta: InventoryCollectMeta;
}> {
  const entries: UpdateHubEntry[] = [];
  const probe = new HostSoftwareProbe(input.host);

  const self = await checkSelfUpdate({ currentVersion: input.currentPanelVersion });
  entries.push({
    id: 'panel:ysk-server',
    title: 'YSK Server',
    group: 'panel',
    kind: 'npm-panel',
    packageName: self.packageName || CANONICAL_NPM_PACKAGE,
    currentVersion: self.currentVersion,
    latestVersion: self.checked ? self.latestVersion : undefined,
    installed: true,
    upgradable: Boolean(self.updateAvailable && self.checked),
    href: '/updates',
    applyPath: 'panel',
    notes: self.ok ? self.notes.filter((n) => !/HTTP 404|@ysk\//i.test(n)) : self.notes,
    summary: self.updateAvailable ? `${self.currentVersion} → ${self.latestVersion}` : undefined,
  });

  const catalogUps = await probe.upgrades();
  const byId = new Map(catalogUps.map((u) => [u.id, u]));

  for (const spec of SOFTWARE_CATALOG) {
    const { group, kind, applyPath } = catalogKind(spec);
    const title = spec.title;
    const href = hrefFor(spec);

    if (kind === 'runtime' || kind === 'npm-global') {
      if (!input.refreshRuntimes) {
        const pres = await probe.presence(spec.id);
        const ver = await probe.version(spec.id);
        entries.push({
          id: `catalog:${spec.id}`,
          title,
          group,
          kind,
          softwareId: spec.id,
          packageName: spec.npmPackages?.[0] || spec.id,
          currentVersion: ver.version,
          installed: pres.installed,
          upgradable: false,
          href,
          applyPath: pres.installed ? applyPath : 'none',
          notes: ['scan to refresh runtime latest'],
        });
        continue;
      }
      const st = await resolveSoftwareVersionStatus({
        host: input.host,
        dataDir: input.dataDir,
        id: spec.id,
        refresh: true,
      });
      entries.push({
        id: `catalog:${spec.id}`,
        title,
        group,
        kind,
        softwareId: spec.id,
        packageName: st.packageName || spec.npmPackages?.[0] || spec.id,
        currentVersion: st.currentVersion,
        latestVersion: st.latestVersion,
        installed: st.installed,
        upgradable: Boolean(st.installed && st.upgradable),
        href,
        applyPath: st.installed ? applyPath : 'none',
        notes: st.notes,
      });
      continue;
    }

    const up = byId.get(spec.id);
    const installed = Boolean(up?.installed);
    const currentVersion = up?.currentVersion;
    const latestVersion = up?.candidateVersion || up?.currentVersion;
    const upgradable = Boolean(up?.upgradable && installed);
    let risk: string | undefined;
    let requiresApproval: boolean | undefined;
    let summary: string | undefined;
    if (installed && currentVersion) {
      const advised = adviseUpdate({
        packageName: up?.packageName || spec.aptPackages[0] || spec.id,
        currentVersion,
        candidateVersion: latestVersion,
      });
      risk = advised.risk;
      requiresApproval = advised.requiresApproval;
      summary = advised.summary;
    }
    entries.push({
      id: `catalog:${spec.id}`,
      title: resolveSoftwareTitle(spec) || title,
      group,
      kind,
      softwareId: spec.id,
      packageName: up?.packageName || spec.aptPackages[0],
      currentVersion,
      latestVersion,
      installed,
      upgradable,
      href,
      applyPath: installed ? 'apt' : 'none',
      risk,
      requiresApproval,
      summary,
      notes: up?.notes ?? [],
    });
  }

  const { items, meta } = await collectInventory(input.host);
  const claimed = catalogAptNames();
  for (const item of items) {
    if (claimed.has(item.packageName)) continue;
    const advised = adviseUpdate(item);
    const upgradable = Boolean(
      item.candidateVersion && item.candidateVersion !== item.currentVersion,
    );
    entries.push({
      id: `os:${item.packageName}`,
      title: item.packageName,
      group: 'os',
      kind: 'apt',
      packageName: item.packageName,
      currentVersion: item.currentVersion,
      latestVersion: item.candidateVersion,
      installed: true,
      upgradable,
      href: '/updates',
      applyPath: 'apt',
      risk: advised.risk,
      cves: advised.cves,
      requiresApproval: advised.requiresApproval,
      summary: advised.summary,
      notes: [],
    });
  }

  return { entries, inventoryMeta: meta };
}

export function summarizeHub(entries: UpdateHubEntry[]): {
  panelUpgradable: number;
  serviceUpgradable: number;
  runtimeUpgradable: number;
  osUpgradable: number;
  highRisk: number;
  badgeCount: number;
} {
  const up = (g: UpdateHubGroup) =>
    entries.filter((e) => e.group === g && e.upgradable).length;
  const panelUpgradable = up('panel');
  const serviceUpgradable = up('service');
  const runtimeUpgradable = up('runtime');
  const osUpgradable = up('os');
  const highRisk = entries.filter(
    (e) => e.upgradable && (e.risk === 'high' || e.risk === 'critical'),
  ).length;
  return {
    panelUpgradable,
    serviceUpgradable,
    runtimeUpgradable,
    osUpgradable,
    highRisk,
    badgeCount: panelUpgradable + serviceUpgradable + runtimeUpgradable + osUpgradable,
  };
}
