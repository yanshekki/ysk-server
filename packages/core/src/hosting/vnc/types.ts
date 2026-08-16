/**
 * VNC control plane types — multi-account server + client dual path.
 */

import { ErrorCodes, YskError, tl } from 'ysk-server-shared';
import { isCloudMetadataHost } from '../../net/ssrf.js';

/** Session desktop: full XFCE or terminal-only. */
export type VncDesktopProfile = 'xfce' | 'terminal';

/** Map stored/legacy values (minimal, none) onto current profiles. */
export function normalizeVncDesktopProfile(raw: unknown): VncDesktopProfile {
  const s = String(raw ?? '').toLowerCase().trim();
  if (s === 'xfce') return 'xfce';
  return 'terminal';
}

export type VncRfbBind = 'localhost' | 'all';

/**
 * Outbound client path — both are browser VNC (panel RFB proxy).
 * - user_reachable: public / user-side target (default), e.g. hostname:5901
 * - server_proxy: emphasize egress from control-plane network (LAN / server-only targets)
 *
 * Legacy: via_server → server_proxy, direct → user_reachable (direct no longer means vncviewer).
 */
export type VncConnectPath = 'user_reachable' | 'server_proxy';

export function normalizeVncConnectPath(raw: unknown): VncConnectPath {
  const s = String(raw ?? '').toLowerCase().trim();
  if (s === 'server_proxy' || s === 'via_server' || s === 'proxy') return 'server_proxy';
  // direct | user_reachable | browser | default
  return 'user_reachable';
}

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
  /** noVNC/websockify always binds 127.0.0.1 on this port when running. */
  novncHttpPort?: number;
  createdAt: string;
};

export type VncClientProfile = {
  id: string;
  name: string;
  /** Display / default connect host (public hostname or IP). */
  host: string;
  port: number;
  path: VncConnectPath;
  /**
   * Optional TCP target when path is server_proxy (e.g. LAN IP only the
   * control plane can reach). Empty = use host.
   */
  connectHost?: string | null;
  status: 'up' | 'down' | 'unknown' | 'error';
  autostart: boolean;
  createdAt: string;
};

/** Host the panel opens TCP to for browser VNC proxy. */
export function resolveClientRfbHost(profile: {
  host: string;
  path?: VncConnectPath | string;
  connectHost?: string | null;
}): string {
  const path = normalizeVncConnectPath(profile.path);
  const override = String(profile.connectHost ?? '').trim();
  if (path === 'server_proxy' && override) return override;
  return String(profile.host ?? '').trim();
}

/** IMDS / link-local metadata — loopback is allowed (local desktop RFB). */
export function isBlockedVncRfbHost(host: string): boolean {
  const raw = String(host ?? '').trim();
  if (!raw || raw.length > 253) return true;
  if (/[\0\s/\\]/.test(raw)) return true;
  const inner = raw.replace(/^\[|\]$/g, '');
  return isCloudMetadataHost(raw) || isCloudMetadataHost(inner);
}

export function assertSafeVncRfbHost(host: string, field = 'host'): string {
  const h = String(host ?? '').trim();
  if (!h || isBlockedVncRfbHost(h)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.vnc.clientInvalid'), {
      httpStatus: 400,
      details: { field, reason: 'rfb_host_blocked' },
    });
  }
  return h;
}

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
