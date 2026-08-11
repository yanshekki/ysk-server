# VPN (Server + Client)

> Language: English | [中文](./vpn-ZH.md)

## Purpose

Manage **open-source VPN** on the control-plane host:

- **Server** — this host accepts WireGuard clients (phones, laptops, other servers)
- **Client** — this host connects *out* to another VPN using an imported conf

## Engines

| Engine | Status |
|--------|--------|
| WireGuard | Full server + client |
| OpenVPN | Full server + client (PKI, `.ovpn`) |
| Shadowsocks (`ss-server`) | Server + `ss://` access keys / QR (not full Outline Manager) |

## Route

| Item | Value |
|------|--------|
| UI | `/vpn` |
| API | `/api/v1/vpn/*` |
| Capability | `network.vpn` |
| Install | Software catalog `wireguard` / `openvpn` (`YSK_EXECUTE` + root) |

## Server flow

1. Install tab → WireGuard / OpenVPN / Shadowsocks as needed  
2. Server tab → listen port + **public endpoint** (host:port used in QR / download; must match firewall)  
3. **Access mode** (per server profile):
   | Mode | Client traffic | Server NAT (MASQUERADE) |
   |------|----------------|-------------------------|
   | **full** | Internet via VPN (`redirect-gateway` / `AllowedIPs 0.0.0.0/0`) | Yes |
   | **lan** | VPN net + configured LAN CIDRs only | No (unless custom includes `0.0.0.0/0`) |
   | **custom** | Explicit CIDR list | Only if list includes default route |
4. Start server → open firewall  
5. Create client → **Download key** / **QR code** (endpoint from validated public host, not wrong port)

## Client flow (this host connects out)

1. Paste WireGuard / OpenVPN conf → Import  
2. Connect / Disconnect  
3. **Full-tunnel protect**: if the conf is full-tunnel (`AllowedIPs` / redirect default route), the panel injects **source-based policy routing** so traffic **from this host’s public IPs** still uses the main table — panel / SSH stay reachable while outbound client traffic can use the tunnel.

## Honesty

Without `YSK_EXECUTE`, install and server/client up are **blocked** (no half-configured state).  
Access mode changes rewrite server push / peer AllowedIPs and re-apply NAT only when `needsInternetNat` is true.

## Related

- [VNC](./vnc.md) — often used after VPN tunnel  
