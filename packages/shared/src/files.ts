/**
 * File manager entries / trash / shares — API contract.
 */

export interface FileEntryDto {
  name: string;
  path: string;
  type: 'file' | 'dir' | string;
  size: number;
  mtime: string;
  mime?: string;
  ext?: string;
  favorite?: boolean;
}

export interface TrashEntryDto extends FileEntryDto {
  trashId: string;
  originalPath: string;
  deletedAt: string;
}

export interface FileShareDto {
  id: string;
  token: string;
  root: string;
  path: string;
  expiresAt?: string;
  createdAt: string;
  createdBy: string;
  downloadCount: number;
  url?: string;
}

export type FileEntry = FileEntryDto;
export type TrashEntry = TrashEntryDto;
export type FileShare = FileShareDto;
