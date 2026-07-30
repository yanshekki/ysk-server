/**
 * Package inventory advice — API contract.
 * Complements UpdateItemDto / SelfUpdateStatus in dto.ts.
 */

export interface UpdateAdviceRowDto {
  packageName: string;
  currentVersion: string;
  candidateVersion?: string;
  advice?: string;
  risk?: string;
  summary?: string;
  cves?: string[];
  requiresApproval?: boolean;
}

export interface UpdateInventoryMetaDto {
  source?: string;
  upgradableCount?: number;
  notes?: string[];
}

/** Web aliases */
export type AdviceRow = UpdateAdviceRowDto;
export type InventoryMeta = UpdateInventoryMetaDto;
