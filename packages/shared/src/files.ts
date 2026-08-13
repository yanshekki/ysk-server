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

/** What to do when the destination path already exists. */
export type FileIfExists = 'fail' | 'overwrite' | 'rename';

/** Directory create when the path already exists. `merge` = keep existing dir. */
export type DirIfExists = 'fail' | 'merge' | 'rename' | 'overwrite';

/** Split `photo.jpg` → stem `photo`, ext `.jpg`. Dotfiles stay whole (`/.gitignore`). */
export function splitFileStemExt(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.');
  if (i <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, i), ext: name.slice(i) };
}

/**
 * Desktop-style unique name: `photo.jpg` → `photo (1).jpg` → `photo (2).jpg`.
 * Folders keep the full name as the stem (`photos` → `photos (1)`).
 */
export function uniqueFileName(
  name: string,
  taken: Iterable<string>,
  opts?: { kind?: 'file' | 'dir' },
): string {
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(name)) return name;
  const kind = opts?.kind ?? 'file';
  const { stem, ext } = kind === 'dir' ? { stem: name, ext: '' } : splitFileStemExt(name);
  for (let n = 1; n <= 9999; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!set.has(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

export function parseFileIfExists(value: unknown, fallback: FileIfExists): FileIfExists {
  if (value === 'fail' || value === 'overwrite' || value === 'rename') return value;
  return fallback;
}

export function parseDirIfExists(value: unknown, fallback: DirIfExists = 'merge'): DirIfExists {
  if (value === 'fail' || value === 'merge' || value === 'rename' || value === 'overwrite') {
    return value;
  }
  return fallback;
}
