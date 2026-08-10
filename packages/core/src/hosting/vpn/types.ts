/**
 * VPN control plane types — server + client dual mode.
 */

export type VpnEngineId = 'wireguard' | 'openvpn' | 'outline';

export type VpnPortProto = 'udp' | 'tcp' | 'both';

export type VpnEngineStatus = {
  engine: VpnEngineId;
  title: string;
  installed: boolean;
  /** Server listening / unit active */
  serverActive: boolean;
  serverPort: number | null;
  serverProto: VpnPortProto | null;
  peerCount: number;
  /** Client profiles imported on this host */
  clientProfileCount: number;
  clientConnectedCount: number;
  notes: string[];
  bins: string[];
  missingBins: string[];
};

export type VpnOverviewStatus = {
  engines: VpnEngineStatus[];
  endpointHint: string | null;
  executeEnabled: boolean;
  isRoot: boolean;
};

export type VpnServerPeer = {
  id: string;
  name: string;
  engine: VpnEngineId;
  /** Client tunnel IP e.g. 10.66.0.2/32 */
  address: string;
  publicKey: string;
  createdAt: string;
  /** Optional last handshake iso */
  lastHandshakeAt?: string | null;
};

export type VpnClientProfile = {
  id: string;
  name: string;
  engine: VpnEngineId;
  /** Interface / unit suffix */
  iface: string;
  status: 'up' | 'down' | 'unknown' | 'error';
  autostart: boolean;
  createdAt: string;
  notes?: string[];
};

export type VpnPortPreset = {
  engine: VpnEngineId;
  port: number;
  proto: VpnPortProto;
  label: string;
  recommended?: boolean;
};
