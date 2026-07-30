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
}

export type SoftwareStatus = SoftwareStatusDto;
export type SoftwareInstallResult = SoftwareInstallResultDto;
