/**
 * Host network interface types (iproute2-shaped, honest).
 */

export type NetAddress = {
  family: 'inet' | 'inet6';
  local: string;
  prefixlen: number;
  scope?: string;
  label?: string;
  /** dynamic / temporary from kernel when present */
  dynamic?: boolean;
};

export type NetLinkStats = {
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  rxErrors?: number;
  txErrors?: number;
};

export type NetInterface = {
  name: string;
  ifindex: number;
  mac?: string;
  mtu?: number;
  operstate: string;
  flags: string[];
  linkType?: string;
  addrs: NetAddress[];
  stats?: NetLinkStats;
  isLoopback: boolean;
  /** Default IPv4 route egress */
  isDefaultEgress?: boolean;
};

export type NetRoute = {
  dst: string;
  gateway?: string;
  dev?: string;
  protocol?: string;
  metric?: number;
  scope?: string;
  prefsrc?: string;
  flags?: string[];
};

export type NetDnsInfo = {
  /** Effective servers to show (uplink preferred; filters stub 127.0.0.53) */
  nameservers: string[];
  search: string[];
  source: string;
  notes: string[];
  /** How DNS is managed on this host */
  mode?: 'networkmanager' | 'resolved' | 'static' | 'unknown';
  /** Can apply via NM connection (or false if only view) */
  canApply?: boolean;
  /** Active NM connection name used for apply */
  connection?: string;
  /** Device bound to that connection */
  device?: string;
  /** Raw /etc/resolv.conf servers (may be stub) */
  stubServers?: string[];
  /** From resolvectl / NM — real uplink */
  uplinkServers?: string[];
  /** NM ipv4.ignore-auto-dns */
  ignoreAutoDns?: boolean | null;
  /** Suggested gateway DNS (router) if known */
  gatewayDns?: string;
};

export type NetBackend = {
  hasIp: boolean;
  networkManager: 'active' | 'inactive' | 'unknown';
  networkd: 'active' | 'inactive' | 'unknown';
  canPersist: boolean;
};

export type NetworkSnapshot = {
  ok: boolean;
  at: string;
  interfaces: NetInterface[];
  routes: NetRoute[];
  dns: NetDnsInfo;
  backend: NetBackend;
  caps: {
    executeEnabled: boolean;
    isRoot: boolean;
    canMutate: boolean;
  };
  /** default IPv4 gateway if any */
  defaultGateway?: string;
  defaultDev?: string;
  notes: string[];
  /** optional raw dumps for advanced tab */
  raw?: { addr?: string; route?: string };
};

export type NetApplyResult = {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  executeEnabled?: boolean;
  isRoot?: boolean;
  ephemeral?: boolean;
  persistent?: boolean;
  interface?: string;
};
