# VNC

> Language: English | [中文](./vnc-ZH.md)

## Purpose

Provide **desktop remote access** on the control-plane host: TigerVNC accounts, outbound client profiles, share links, and noVNC helpers.

**Non-goals:** Replacing a full remote-desktop product; multi-tenant desktop SaaS.

## Panel

| Item | Value |
|------|--------|
| Route | `/vnc` · share landing `/vnc-share/:token` |
| Nav key | `vnc` |
| Main areas | Status · Accounts · Clients · Viewer · Share |
| Capability | VNC hosting capabilities |
| RBAC | Operators allowed to manage VNC |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Stack / status | `ysk-server vnc status --json` | read | |
| Settings get/set | `ysk-server vnc settings get\|set …` | write-panel | |
| List accounts | `ysk-server vnc accounts list --json` | read | |
| Create account | `ysk-server vnc accounts create --name N --execute --json` | write-host | Linux user + VNC |
| Update / password | `ysk-server vnc accounts update\|password …` | write-host | password needs execute |
| Start / stop / delete | `ysk-server vnc accounts start\|stop\|delete --id … --execute` | write-host | |
| Connection info | `ysk-server vnc connection --id … --json` | read | |
| Firewall open | `ysk-server vnc firewall --id … --execute` | write-host | |
| noVNC start/stop | `ysk-server vnc novnc start\|stop --id … --execute` | write-host | |
| Client profiles CRUD | `ysk-server vnc clients …` | write-panel / write-host | up/down host |
| Share create/info/revoke | `ysk-server vnc share …` | write-panel | |
| Session mint (metadata) | `ysk-server vnc session mint --id …` | read/write-host | may start desktop |
| **In-panel RFB canvas** | — | ⚠️ panel-only | Interactive viewer |

## CLI quick start

```bash
ysk-server vnc status --json
ysk-server vnc accounts list --json
export YSK_EXECUTE=1
ysk-server vnc accounts create --name alice --password '…' --execute --json
ysk-server vnc share create --id ACCOUNT_ID --json
ysk-server vnc session mint --id ACCOUNT_ID --json
```

Full argv: [../cli/reference.md](../cli/reference.md#vnc).

## Honesty

- Account create/start/stop need EXECUTE + root for `useradd` / `vncserver`.  
- Share links are short-lived tokens; public landing is HTTP UX.  
- `session mint` returns RFB metadata; it does **not** open a desktop canvas in the terminal.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Browser VNC viewer (canvas, clipboard, record) | Interactive WebSocket RFB UI |
| Public share page interaction | Browser-only redeem flow |

## Related

- [Panel ↔ CLI matrix](../cli/panel-parity-matrix.md)  
- [CLI reference — vnc](../cli/reference.md#vnc)  
- [VPN](./vpn.md)  
- [Ops honesty](../architecture/ops-honesty.md)  
