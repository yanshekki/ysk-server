/**
 * One-click software install catalog — API contract.
 */

export interface SoftwareStatusDto {
  id: string;
  title: string;
  installed: boolean;
  active?: string;
  bins: string[];
  missingBins: string[];
  features: string[];
}

export interface SoftwareInstallResultDto {
  ok: boolean;
  executed?: boolean;
  blocked?: boolean;
  blockMessage?: string;
  id?: string;
  title?: string;
  installed?: boolean;
  notes?: string[];
  steps?: Array<{ name: string; status: string; detail?: string }>;
  status?: SoftwareStatusDto;
  results?: SoftwareInstallResultDto[];
  /**
   * When set to needs_exclusive_switch, UI must open SQL engine switch dialog
   * (MySQL XOR MariaDB) instead of bare apt install.
   */
  code?: 'needs_exclusive_switch' | string;
  /** Present when code=needs_exclusive_switch */
  switchTarget?: 'mysql' | 'mariadb';
  blockedByExclusive?: string;
}

export type SoftwareStatus = SoftwareStatusDto;
export type SoftwareInstallResult = SoftwareInstallResultDto;
