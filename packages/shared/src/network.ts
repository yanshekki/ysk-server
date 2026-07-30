/**
 * Host network snapshot + apply results — API contract.
 */

export interface NetAddressDto {
  family: 'inet' | 'inet6';
  local: string;
  prefixlen: number;
  scope?: string;
  label?: string;
  dynamic?: boolean;
}

export interface NetInterfaceDto {
  name: string;
  ifindex: number;
  mac?: string;
  mtu?: number;
  operstate: string;
  flags: string[];
  linkType?: string;
  addrs: NetAddressDto[];
  stats?: {
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
  };
  isLoopback: boolean;
  isDefaultEgress?: boolean;
}

export interface NetRouteDto {
  dst: string;
  gateway?: string;
  dev?: string;
  protocol?: string;
  metric?: number;
  scope?: string;
  prefsrc?: string;
}

export interface NetworkSnapshotDto {
  ok: boolean;
  at: string;
  interfaces: NetInterfaceDto[];
  routes: NetRouteDto[];
  dns: {
    nameservers: string[];
    search: string[];
    source: string;
    notes: string[];
    mode?: 'networkmanager' | 'resolved' | 'static' | 'unknown';
    canApply?: boolean;
    connection?: string;
    device?: string;
    stubServers?: string[];
    uplinkServers?: string[];
    ignoreAutoDns?: boolean | null;
    gatewayDns?: string;
  };
  backend: {
    hasIp: boolean;
    networkManager: string;
    networkd: string;
    canPersist: boolean;
  };
  caps: {
    executeEnabled: boolean;
    isRoot: boolean;
    canMutate: boolean;
  };
  defaultGateway?: string;
  defaultDev?: string;
  notes: string[];
  raw?: { addr?: string; route?: string };
}

/** Mutation result for network addr/route/dns (ops-like). */
export interface NetApplyResultDto {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  executeEnabled?: boolean;
  isRoot?: boolean;
  ephemeral?: boolean;
  persistent?: boolean;
  interface?: string;
}

/** Aliases used by older web code */
export type NetAddress = NetAddressDto;
export type NetInterface = NetInterfaceDto;
export type NetRoute = NetRouteDto;
export type NetworkSnapshot = NetworkSnapshotDto;
export type NetApplyResult = NetApplyResultDto;
