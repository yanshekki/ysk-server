# VNC (server accounts + client)

> Language: English | [繁體中文（香港）](./vnc-ZH.md)

## Purpose

Manage **remote desktop** on the control-plane host:

- **Server accounts** — each account is a dedicated **Linux user** (`yskvnc_*`) with its own TigerVNC display
- **Connection paths** — **via server** (noVNC/websockify on localhost) or **direct RFB** on the user’s network
- **Client** — connect this host **outbound** to a remote VNC server (same dual path)

## Stack

| Component | softwareId | Notes |
|-----------|------------|--------|
| TigerVNC | `tigervnc` | Multi-user `vncserver` sessions |
| noVNC + websockify | `novnc` | Browser access; RFB stays on 127.0.0.1 by default |
| XFCE (optional) | `vnc-desktop-xfce` | Full desktop profile |
| Viewer (optional) | `tigervnc-viewer` | Direct client path |

Desktop profiles per account: **minimal** · **xfce** · **none**.

## Routes

| Item | Value |
|------|--------|
| UI | `/vnc` |
| API | `/api/v1/vnc/*` |
| Capability | `network.vnc` (+ `firewall.edit` to open ports) |
| Install | Software banners need **root + `YSK_EXECUTE`** |

## Server workflow

1. **Install** tab → TigerVNC (then noVNC)
2. **Settings** → default desktop / geometry / RFB bind (default **localhost**)
3. **Accounts** → create account (Linux user + display `:N` / port `5900+N`)
4. Set VNC password → **Start** session
5. **Connect** materials:
   - **Via server**: Start noVNC → open local URL (or SSH-tunnel the HTTP port)
   - **Direct**: bind=all + UFW open TCP `5900+N` → RealVNC/TigerVNC clients

## Client workflow

1. **Client** tab → add remote `host:port`
2. Choose path: **via server** (websockify proxy + local noVNC) or **direct** (`vncviewer`)
3. Connect / disconnect

## Safety

- RFB defaults to **localhost only** — prefer noVNC or VPN for exposure
- Passwords are not written to audit logs
- Without `YSK_EXECUTE` / root: control-plane meta is written; system ops return **blocked** honestly
- Linux user delete is optional on account remove

## API (summary)

| Method | Path |
|--------|------|
| GET | `/api/v1/vnc/status` |
| GET/PATCH | `/api/v1/vnc/settings` |
| GET/POST | `/api/v1/vnc/accounts` |
| PATCH/DELETE | `/api/v1/vnc/accounts/:id` |
| POST | `/api/v1/vnc/accounts/:id/start\|stop\|password` |
| GET | `/api/v1/vnc/accounts/:id/connection` |
| POST | `/api/v1/vnc/accounts/:id/novnc/start\|stop` |
| POST | `/api/v1/vnc/accounts/:id/firewall` |
| GET/POST | `/api/v1/vnc/client/profiles` |
| POST | `/api/v1/vnc/client/profiles/:id/up\|down` |

## Related

- [VPN](./vpn.md) — tunnel first, then VNC
- Firewall / Protection center — port policy
