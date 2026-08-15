/**
 * BitTorrent tracker + seeder settings / status DTOs (panel + API + CLI).
 */

export type BtTrackerSettings = {
  /** Bind address for tracker HTTP/WS (default 0.0.0.0 when public; often 127.0.0.1 private) */
  listenHost: string;
  /** HTTP + WebSocket tracker port (default 8000) */
  httpPort: number;
  /** UDP tracker port; 0 = disabled (default 0) */
  udpPort: number;
  /** Enable WebSocket tracker for browser WebTorrent */
  wsEnabled: boolean;
  /** Start with control plane / on demand */
  autostart: boolean;
  /**
   * Public base used in magnet announce list (host:port or full URL prefix).
   * Empty = derive from request host / endpoint hint at create time.
   */
  publicAnnounceHost: string;
  /** Max concurrent seeded shares */
  maxSeeds: number;
  /** Peer listen port range start for seeder (inclusive) */
  seederPortMin: number;
  /** Peer listen port range end (inclusive) */
  seederPortMax: number;
  /**
   * Extra announce URLs the operator adds (library download/seed + share seed).
   * Empty by default — never invent public tracker lists.
   */
  extraTrackers: BtExtraTracker[];
};

export type BtExtraTracker = {
  url: string;
  enabled: boolean;
};

export const DEFAULT_BT_TRACKER_SETTINGS: BtTrackerSettings = {
  listenHost: '0.0.0.0',
  httpPort: 8000,
  udpPort: 0,
  wsEnabled: true,
  autostart: false,
  publicAnnounceHost: '',
  maxSeeds: 32,
  seederPortMin: 6881,
  seederPortMax: 6889,
  extraTrackers: [],
};

export type BtTrackerStatus = {
  installed: boolean;
  running: boolean;
  pid: number | null;
  settings: BtTrackerSettings;
  /** http://host:port/announce style hints */
  announceUrls: string[];
  executeEnabled: boolean;
  isRoot: boolean;
  notes: string[];
  stats?: {
    torrents: number;
    peers: number;
    announces?: number;
  };
  startedAt?: string | null;
};

export type BtLibraryStatus =
  | 'queued'
  | 'checking'
  | 'downloading'
  | 'seeding'
  | 'paused'
  | 'error';

export type BtLibraryItem = {
  id: string;
  infoHash: string;
  name: string;
  torrentRelPath?: string;
  saveRoot: string;
  saveRelPath: string;
  source: 'library' | 'share';
  shareId?: string;
  status: BtLibraryStatus;
  magnetUri?: string;
  sizeBytes?: number;
  errorNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type BtLibraryFile = {
  path: string;
  length: number;
};

export type BtLibraryInspect = {
  infoHash: string;
  name: string;
  sizeBytes: number;
  private?: boolean;
  announce: string[];
  files: BtLibraryFile[];
  magnetUri?: string;
};

export type BtLibraryDestMode = 'download' | 'seed-existing';

export type BtLibraryDestProbe = {
  destRel: string;
  seedRel: string | null;
  destKind: 'missing' | 'dir' | 'file-conflict';
  matchCount: number;
  totalFiles: number;
  canSeedExisting: boolean;
  conflictName?: string;
};

export type BtTrackerTorrentRow = {
  infoHash: string;
  name?: string;
  seeders: number;
  leechers: number;
  completed?: number;
  shareId?: string;
  seedStatus?: string;
  uploadSpeed?: number;
  downloadSpeed?: number;
  kind?: 'library' | 'share' | 'swarm';
  libraryId?: string;
  progress?: number;
  sizeBytes?: number;
  downloaded?: number;
  saveRoot?: string;
  saveRelPath?: string;
};
