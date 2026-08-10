# Host Browse

> Language: English | [中文](./host-browse-ZH.md)

## Purpose

**Host Browse** lets operators open HTTP(S) URLs **through the control-plane host**:

- Internet (public sites) and Intranet (LAN / RFC1918 admin UIs)
- Egress IP, DNS, and TLS use the **host** — not the operator’s desktop browser
- Target sites never see the operator browser User-Agent, Client Hints, panel cookies, or operator client IP

## Dual engine

| Engine | How it works | Best for |
|--------|----------------|----------|
| **Proxy** (default if no Chrome) | Host HTTP fetch + HTML/CSS rewrite + sandboxed iframe | Docs, static sites, many admin panels, form POST |
| **Real browser** | Host **Chromium** via Playwright + JPEG screencast + mouse/keyboard | Heavy SPAs (e.g. modern marketing sites), JS-heavy UIs |

- UI toggle: **Proxy | Real browser**
### Panel settings (recommended)

On **Host Browse → Settings** (or Software tab):

| Setting | Effect |
|---------|--------|
| Default engine | auto / proxy / real browser |
| Chrome path | Override auto-detect |
| Allow loopback | Intranet may open 127.0.0.1 |
| --no-sandbox | Container-friendly Chromium |

Stored in panel DB (`settings.hostBrowse`). **Panel values override process env.**

### One-click install

**Software** tab → installs catalog id `chromium` (distro Chromium via apt). Also detects existing Google Chrome binaries. Needs root + `YSK_EXECUTE=1`.

### Process env (fallback if panel empty)

- `YSK_HOST_BROWSE_ENGINE=auto|proxy|browser`
- `YSK_HOST_BROWSE_CHROME=/path/to/chrome`
- `YSK_HOST_BROWSE_NO_SANDBOX=1`
- `YSK_HOST_BROWSE_LOOPBACK=1`

If Chrome is missing and engine=`browser` is requested, API returns `YSK_HOST_BROWSE_NEED_CHROME` (honest fail / UI falls back).

## Route

| Item | Value |
|------|--------|
| UI | `/browse` |
| API | `/api/v1/host-browse/*` |
| Live WS | `/api/v1/host-browse/ws?ticket=` |
| Capability | `network.browse` (privilege; admin factory includes it) |
| `YSK_EXECUTE` | **Not required** |

## Tabs

| Tab | Content |
|-----|---------|
| Browse | Browser chrome + mode + engine + viewport |
| About | Page guide |

## Privacy model

- Fixed User-Agent: `YSK-HostBrowse/1.0 …` (both engines)
- Header allowlist only (proxy); Playwright context uses the same fixed UA
- Cookie jar / browser storage **server-side only**
- Content iframe uses short-lived `contentToken`; live WS uses one-time ticket

## SSRF

| Mode | Policy |
|------|--------|
| Internet | Block loopback, RFC1918, link-local, ULA, cloud metadata |
| Intranet | Allow private LAN; **always** block cloud metadata; loopback off unless env |

## Limits

- Proxy: not a full Chromium substitute for all SPAs
- Browser engine: needs host Chrome; CPU/RAM limited (session caps)
- No guarantee of bypassing site bot protection
- Response body ~8 MiB (proxy); rate ~60 nav/user/min

## Related

[product-page-map](../product-page-map.md)

## Real browser: quality & size

- **Quality presets**: Smooth / Balanced (default) / Sharp — apply live over WebSocket without restarting the session.
- **Viewport**: Defaults to the panel surface size; resizes sync Chromium viewport.
- **Zoom**: Fit window or percent (display only); pointer mapping accounts for letterboxing.
- **Errors**: Timeout, DNS, TLS, bot challenge, stream failure — coded messages with retry actions.

## Browser shell

- **Scroll** fixed for real-browser live surface
- **Compact toolbar**: quality/zoom as compact selects
- **Home / bookmarks / history**
- **Multi-tab** (up to 6) + fullscreen
- **Leave page**: heartbeat reap kills Chrome; ephemeral Linux user removed when created
- **Danger policy**: blocklist + warn
- **Media**: video via screencast; audio not bridged yet (phase 2)

