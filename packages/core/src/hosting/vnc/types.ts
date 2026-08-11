/**
 * VNC control plane types — multi-account server + client dual path.
 */

/** Session desktop: full XFCE or terminal-only. */
export type VncDesktopProfile = 'xfce' | 'terminal';

/** Map stored/legacy values (minimal, none) onto current profiles. */
export function normalizeVncDesktopProfile(raw: unknown): VncDesktopProfile {
  const s = String(raw ?? '').toLowerCase().trim();
  if (s === 'xfce') return 'xfce';
  return 'terminal';
}

export type VncRfbBind = 'localhost' | 'all';

export type VncConnectPath = 'via_server' | 'direct';

export type VncStackId = 'tigervnc' | 'novnc' | 'xfce' | 'viewer';

export type VncStackStatus = {
  id: VncStackId;
  title: string;
  installed: boolean;
  bins: string[];
  missingBins: string[];
  notes: string[];
};

export type VncAccountSummary = {
  id: string;
  name: string;
  linuxUser: string;
  display: number;
  rfbPort: number;
  desktop: VncDesktopProfile;
  status: 'running' | 'stopped' | 'failed' | 'written' | 'unknown';
  rfbBind: VncRfbBind;
  geometry: string;
  depth: number;
  autostart: boolean;
  hasPassword: boolean;
  novncRunning: boolean;
  createdAt: string;
};

export type VncClientProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  path: VncConnectPath;
  status: 'up' | 'down' | 'unknown' | 'error';
  autostart: boolean;
  createdAt: string;
};

export type VncSettings = {
  defaultDesktop: VncDesktopProfile;
  defaultGeometry: string;
  defaultDepth: number;
  defaultRfbBind: VncRfbBind;
  defaultAutostart: boolean;
  displayMin: number;
  displayMax: number;
};

export type VncOverviewStatus = {
  stacks: VncStackStatus[];
  accountCount: number;
  runningCount: number;
  clientProfileCount: number;
  clientConnectedCount: number;
  settings: VncSettings;
  endpointHint: string | null;
  executeEnabled: boolean;
  isRoot: boolean;
  notes: string[];
};

export const DEFAULT_VNC_SETTINGS: VncSettings = {
  defaultDesktop: 'xfce',
  defaultGeometry: '1920x1080',
  defaultDepth: 24,
  defaultRfbBind: 'localhost',
  defaultAutostart: false,
  displayMin: 1,
  displayMax: 99,
};
