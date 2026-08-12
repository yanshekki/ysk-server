# VPN (Server + Client)

> Language: English | [中文](./vpn-ZH.md)

## Purpose

Manage **open-source VPN** on the control-plane host:

- **Server** — accept WireGuard / OpenVPN / Shadowsocks clients  
- **Client** — this host connects *out* using an imported profile  

**Non-goals:** Multi-tenant VPN SaaS; full commercial Outline Manager product.

## Panel

| Item | Value |
|------|--------|
| Route | `/vpn` |
| Nav key | `vpn` |
| Main tabs | Install · Server · Clients · Monitor |
| Capability | `network.vpn` |
| RBAC | Operators with VPN network capability |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Overview / engine status | `ysk-server vpn status --json` | read | |
| Live monitor | `ysk-server vpn monitor [--engine …] --json` | read | |
| Port presets | `ysk-server vpn presets --json` | read | |
| Ensure / apply server | `ysk-server vpn ensure --engine … [--port …] --execute --json` | write-host | |
| List server peers | `ysk-server vpn peers list --engine … --json` | read | |
| Add peer | `ysk-server vpn peers add --name NAME --execute --json` | write-host | |
| Delete peer | `ysk-server vpn peers delete --id ID --execute --json` | write-host | |
| Export peer config | `ysk-server vpn peers config --id ID` | read | QR/download in panel |
| List client profiles | `ysk-server vpn clients list --json` | read | |
| Import client conf | `ysk-server vpn clients import --name N --file PATH --json` | write-panel | |
| Client up / down | `ysk-server vpn clients up\|down --id ID --execute --json` | write-host | |
| Delete client profile | `ysk-server vpn clients delete --id ID --execute --json` | write-host | |
| Open firewall port | `ysk-server vpn firewall open --port N --execute --json` | write-host | via service exposure |

## CLI quick start

```bash
ysk-server vpn status --json
ysk-server vpn peers list --engine wireguard --json
export YSK_EXECUTE=1
ysk-server vpn ensure --engine wireguard --port 51820 --execute --json
ysk-server vpn peers add --name phone --execute --json
ysk-server vpn peers config --id PEER_ID --out ./peer.conf
```

Full argv: [../cli/reference.md](../cli/reference.md#vpn).

## Engines

| Engine | Server | Client |
|--------|--------|--------|
| WireGuard | Full | Full |
| OpenVPN | Full (PKI, `.ovpn`) | Full |
| Shadowsocks (`ss-server`) | Keys / QR (not full Outline Manager) | Limited |

## Honesty

- Without `YSK_EXECUTE` + root, install / ensure / peer mutations stay **blocked** or dry-run.  
- Public **endpoint** in QR must match firewall and real public address.  
- Full-tunnel client conf may inject policy routing so panel/SSH stay reachable.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| QR rendering canvas | Display-only; export conf via CLI |

## Related

- [Panel ↔ CLI matrix](../cli/panel-parity-matrix.md)  
- [CLI reference — vpn](../cli/reference.md#vpn)  
- [VNC](./vnc.md) — often used after tunnel  
- [Ops honesty](../architecture/ops-honesty.md)  
