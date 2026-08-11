# VNC (server accounts + client)

> Language: English | [繁體中文（香港）](./vnc-ZH.md)

## Purpose

Manage **remote desktop** on the control-plane host:

- **Server accounts** — each account is a dedicated **Linux user** (`yskvnc_*`) with its own TigerVNC display
- **In-browser VNC client** — **Open in browser** (primary): panel-proxied RFB over WebSocket + noVNC UI (keyboard, mouse, clipboard, quality, screenshot, short recording)
- **Client profiles** — this host connects **outbound** to a remote `host:port` with the same browser path
- **Legacy paths** — host-side `vncviewer`, and optional localhost noVNC URL (advanced only)

## Stack

| Component | softwareId | Notes |
|-----------|------------|--------|
| TigerVNC | `tigervnc` | Multi-user `vncserver` sessions |
| noVNC (npm `@novnc/novnc`) | — | Embedded in panel; no need to open `127.0.0.1` in the user’s browser |
| Panel WS RFB proxy | — | `POST /api/v1/vnc/sessions` + `WS /api/v1/vnc/ws?ticket=…` pipes binary RFB via the control plane |
| websockify / package noVNC | `novnc` | Optional legacy “Start noVNC” on localhost |
| XFCE (optional) | `vnc-desktop-xfce` | Full desktop profile |
| Viewer (optional) | `tigervnc-viewer` | Host-side direct client path |

Desktop profiles per account: **minimal** · **xfce** · **none**.

## Routes

| Item | Value |
|------|--------|
| UI | `/vnc` |
| Public share view | `/vnc-share/:token` (no panel login; default **view-only**) |
| API | `/api/v1/vnc/*` |
| Capability | `network.vnc` (+ `firewall.edit` to open ports) |
| Install | Software banners need **root + `YSK_EXECUTE`** |

## Browser viewer (primary)

1. **Accounts** or **Client** → **Open in browser**
2. Panel mints a short-lived ticket and connects the browser to RFB through the control plane (works from any browser that can reach the panel — no SSH tunnel for RFB)
3. Toolbar: reconnect, fit/1:1, quality, fullscreen, Ctrl+Alt+Del, clipboard, share link, screenshot, record (WebM ≤60s)
4. Up to **4** concurrent sessions (tab strip)
5. **Share link** (view-only, ~1h): copy URL → guest opens `/vnc-share/:token`

**Client outbound:** the **control-plane host** must be able to TCP-connect to the resolved RFB target — remote `host:port`, or **Connect host** when path is **Via server proxy** (firewall on the remote side).

## Server workflow

1. **Install** tab → TigerVNC
2. **Settings** → default desktop / geometry / RFB bind (default **localhost**)
3. **Accounts** → create account (Linux user + display `:N` / port `5900+N`)
4. Set VNC password → **Start** session (or let **Open in browser** start it)
5. **Open in browser** (recommended)
6. **Connect** materials (advanced): legacy noVNC localhost URL, direct RFB + UFW

## Client workflow

1. **Client** tab → add remote `host:port` and choose a path (**both open VNC in the browser**):
   - **User-reachable endpoint** (default): public hostnames / targets as configured; panel TCP uses **Remote host**
   - **Via server proxy**: traffic egresses via the control-plane network; optional **Connect host** overrides the TCP target (e.g. display `vnc.example.com` but open `10.0.0.9:5901` on the LAN)
2. Before minting a browser ticket the panel **probes RFB TCP** to the resolved host (display host, or Connect host when set under server proxy)
3. **Open in browser**

### Dual path + Connect host

| Field | Role |
|-------|------|
| Remote host | Label / default target shown in the UI |
| Path | `user_reachable` \| `server_proxy` (browser only; no host-side `vncviewer`) |
| Connect host | Optional; **server_proxy only**. Control plane opens TCP here when set; leave empty to use Remote host |

API: `POST/PATCH /api/v1/vnc/client/profiles` accept `connectHost`. Public list hides secrets but still returns `connectHost` for operators.

## Safety

- RFB for local accounts defaults to **localhost**; browser path never exposes RFB on the public internet — only the panel’s authenticated (or share-token) WebSocket
- Share links default to **view-only** and expire
- Passwords are not written to audit logs; optional client password storage lives under dataDir (root-readable)
- Without `YSK_EXECUTE` / root: control-plane meta is written; starting local desktops returns **blocked** honestly

## API (summary)

| Method | Path |
|--------|------|
| GET | `/api/v1/vnc/status` |
| GET/PATCH | `/api/v1/vnc/settings` |
| GET/POST | `/api/v1/vnc/accounts` |
| PATCH/DELETE | `/api/v1/vnc/accounts/:id` |
| POST | `/api/v1/vnc/accounts/:id/start\|stop\|password` |
| GET | `/api/v1/vnc/accounts/:id/connection` |
| POST | `/api/v1/vnc/accounts/:id/novnc/start\|stop` (legacy) |
| POST | `/api/v1/vnc/accounts/:id/firewall` |
| GET/POST | `/api/v1/vnc/client/profiles` |
| POST | `/api/v1/vnc/client/profiles/:id/up\|down` |
| POST | `/api/v1/vnc/sessions` — mint browser ticket |
| WS | `/api/v1/vnc/ws?ticket=…` — RFB binary proxy |
| POST | `/api/v1/vnc/share` — create view-only share |
| GET/POST | `/api/v1/vnc/share/:token` · `…/session` — public redeem |
| DELETE | `/api/v1/vnc/share/:token` — revoke |

## Related

- [VPN](./vpn.md) — tunnel first, then VNC
- Firewall / Protection center — port policy
