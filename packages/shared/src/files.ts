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

/** How a public share may be downloaded */
export type FileShareDownloadMode = 'direct' | 'bt';

export type FileShareSeedStatus =
  | 'none'
  | 'pending'
  | 'seeding'
  | 'stopped'
  | 'error';

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
  /** Default ['direct'] when omitted (legacy shares). */
  downloadModes?: FileShareDownloadMode[];
  infoHash?: string;
  magnetUri?: string;
  /** Relative to dataDir, e.g. files/torrents/{id}.torrent */
  torrentRelPath?: string;
  seedStatus?: FileShareSeedStatus;
  seedNotes?: string[];
}

/**
 * Live BitTorrent swarm stats for a share (not hot-path persisted).
 * Server seeder + optional tracker scrape.
 */
export type BtShareStats = {
  infoHash: string;
  seedStatus: FileShareSeedStatus | string;
  localSeeding: boolean;
  peers: number;
  seeds: number;
  leechers: number;
  completed?: number;
  /** bytes/sec */
  downloadSpeed: number;
  /** bytes/sec */
  uploadSpeed: number;
  downloaded: number;
  uploaded: number;
  progress?: number;
  ratio?: number;
  numPeers?: number;
  wireCount?: number;
  updatedAt: string;
  /** Display name only — never dataDir paths on public API */
  name?: string;
  sizeBytes?: number;
  notes?: string[];
};

export type FileEntry = FileEntryDto;
export type TrashEntry = TrashEntryDto;
export type FileShare = FileShareDto;
