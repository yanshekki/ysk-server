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
};
