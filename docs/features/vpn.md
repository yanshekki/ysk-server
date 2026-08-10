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

1. Install tab → one-click WireGuard  
2. Server tab → listen port (default **51820/udp**) + public endpoint  
3. Start server → open firewall  
4. Create client → **Download key** / **QR code**

## Client flow

1. Paste a WireGuard conf → Import  
2. Connect / Disconnect  

## Honesty

Without `YSK_EXECUTE`, install and server/client up are **blocked** (no half-configured state).
