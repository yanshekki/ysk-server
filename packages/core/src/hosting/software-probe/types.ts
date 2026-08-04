/**
 * Unified software probe contracts — presence / version / upgrade.
 * All product "is installed?" checks must go through HostSoftwareProbe.
 */

export type SoftwareProbeId = string;

export type SoftwarePresence = {
  id: SoftwareProbeId;
  /** Product-semantic installed (honors exclusive packages e.g. mysql vs mariadb) */
  installed: boolean;
  /** Absolute paths of bins found */
  resolvedBins: string[];
  /** Catalog bins not found */
  missingBins: string[];
  /** If another exclusive package owns the host (e.g. mariadb-server) */
  blockedByExclusive?: string;
  packagesPresent?: string[];
  units?: Array<{ name: string; active?: string; enabled?: string }>;
  notes: string[];
};

export type SoftwareVersionInfo = {
  id: SoftwareProbeId;
  installed: boolean;
  version?: string;
  raw?: string;
  source: 'cli' | 'dpkg' | 'unknown';
  notes: string[];
};

export type SoftwareUpgradeInfo = {
  id: SoftwareProbeId;
  packageName: string;
  installed: boolean;
  currentVersion?: string;
  candidateVersion?: string;
  upgradable: boolean;
  source: 'apt' | 'none';
  notes: string[];
};

export type ProbeRegistryEntry = {
  id: SoftwareProbeId;
  title: string;
  bins: string[];
  aptPackages: string[];
  units?: string[];
  /** Other probe ids that cannot coexist as "this" server */
  exclusiveWith?: string[];
  /** CLI for version, e.g. ['nginx','-v'] or ['mysql','--version'] */
  versionCommand?: string[];
  /** Prefer dpkg package name for version/upgrade */
  dpkgPackage?: string;
  /** When true, presence requires exclusive flavor match (server packages) */
  requiresExclusiveFlavor?: boolean;
};
