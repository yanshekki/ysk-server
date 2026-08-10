/**
 * Default VPN listen ports (server inbound).
 */

import type { VpnEngineId, VpnPortPreset, VpnPortProto } from './types.js';

export const VPN_PORT_PRESETS: readonly VpnPortPreset[] = [
  {
    engine: 'wireguard',
    port: 51820,
    proto: 'udp',
    label: 'WireGuard 51820/udp',
    recommended: true,
  },
  { engine: 'wireguard', port: 51821, proto: 'udp', label: 'WireGuard 51821/udp' },
  { engine: 'wireguard', port: 51822, proto: 'udp', label: 'WireGuard 51822/udp' },
  {
    engine: 'openvpn',
    port: 1194,
    proto: 'udp',
    label: 'OpenVPN 1194/udp',
    recommended: true,
  },
  { engine: 'openvpn', port: 443, proto: 'tcp', label: 'OpenVPN 443/tcp' },
  {
    engine: 'outline',
    port: 8388,
    proto: 'tcp',
    label: 'Outline/SS 8388/tcp',
    recommended: true,
  },
] as const;

export function defaultPortForEngine(engine: VpnEngineId): VpnPortPreset {
  return (
    VPN_PORT_PRESETS.find((p) => p.engine === engine && p.recommended) ??
    VPN_PORT_PRESETS.find((p) => p.engine === engine)!
  );
}

export function presetsForEngine(engine: VpnEngineId): VpnPortPreset[] {
  return VPN_PORT_PRESETS.filter((p) => p.engine === engine);
}

export function isValidVpnPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function normalizeProto(raw: unknown): VpnPortProto {
  const s = String(raw ?? 'udp').toLowerCase();
  if (s === 'tcp') return 'tcp';
  if (s === 'both') return 'both';
  return 'udp';
}
