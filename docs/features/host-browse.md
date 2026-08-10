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
| **Real browser** | Host **Chromium** via Playwright + JPEG screencast + mouse/keyboard | Heavy SPAs, JS-heavy UIs |

### Panel settings

| Setting | Effect |
|---------|--------|
| Default engine | auto / proxy / real browser |
| Chrome path | Override auto-detect |
| Allow loopback | Intranet may open 127.0.0.1 |
| --no-sandbox | Container-friendly Chromium |
| Safety level | strict / standard / relaxed (navigate policy) |
| Block hosts | Extra hostname denylist |
| Dangerous downloads | Allow exe/sh/… when enabled |
| **Audio bridge** | PCM from HTML media over live WS (see Media) |

Stored in panel DB (`settings.hostBrowse`). **Panel values override process env.**

### One-click install

**Software** tab → catalog id `chromium` (needs root + `YSK_EXECUTE=1`).

### Process env (fallback)

- `YSK_HOST_BROWSE_ENGINE=auto|proxy|browser`
- `YSK_HOST_BROWSE_CHROME=/path/to/chrome`
- `YSK_HOST_BROWSE_NO_SANDBOX=1`
- `YSK_HOST_BROWSE_LOOPBACK=1`
- `YSK_HOST_BROWSE_AUDIO=1` — enable audio bridge (same as panel)

## Routes

| Item | Value |
|------|--------|
| UI | `/browse` |
| API | `/api/v1/host-browse/*` |
| Live WS | `/api/v1/host-browse/ws?ticket=` |
| Capability | `network.browse` |
| `YSK_EXECUTE` | Not required for browse; required for Chromium install / ephemeral Linux users |

### Session API (auth + `network.browse`)

| Method | Path | Notes |
|--------|------|--------|
| POST | `/sessions` | Create (mode, engine, optional startUrl) |
| POST | `/sessions/:id/navigate` | goto / back / forward / reload |
| POST | `/sessions/:id/live` | One-time WS ticket |
| GET | `/sessions/:id/downloads` | List captured downloads |
| GET | `/sessions/:id/downloads/:dlId` | Authenticated file pull |
| GET | `/sessions/:id/tabs` | List real Chromium pages |
| POST | `/sessions/:id/tabs` | Open tab `{ url? }` (max 6) |
| POST | `/sessions/:id/tabs/:pageId/activate` | Switch tab |
| DELETE | `/sessions/:id/tabs/:pageId` | Close tab |
| GET | `/library` | Home, bookmarks, history, lastSnapshot |
| DELETE | `/last-snapshot` | Dismiss resume banner |
| POST | `/sessions/:id/heartbeat` | Keep browser session alive |

### Live WebSocket messages

**Server → client:** `ready`, `frame` (JPEG base64), `audio` (s16le PCM base64), `audio_status`, `stream_ok`, `tabs`, `meta`, `err`, `pong`

**Client → server:** `mouse`, `key`, `resize`, `stream`, `reconnect_cast`, `tab_open`, `tab_switch`, `tab_close`, `tabs_list`, `ping`

## Privacy model

- Fixed User-Agent: `YSK-HostBrowse/1.0 …`
- Cookie jar / browser profile **server-side only**
- Content iframe: short-lived `contentToken`; live WS: one-time ticket
- Optional ephemeral Linux user `yskb_*` + Chrome-as-user via CDP when root + `YSK_EXECUTE`

## SSRF

| Mode | Policy |
|------|--------|
| Internet | Block loopback, RFC1918, link-local, ULA, cloud metadata |
| Intranet | Allow private LAN; **always** block cloud metadata; loopback off unless allowed |

## Browser shell features

- Scroll, compact toolbar, quality presets (smooth / balanced / sharp)
- Home / bookmarks / history; resume last tabs snapshot on return
- Multi-tab (server-backed, max 6); fullscreen
- Downloads drawer with extension safety
- Leave page / heartbeat reap: stop screencast, kill Chrome, destroy ephemeral user
- Safety level + custom block hosts
- **Media**
  - Video: always JPEG screencast
  - Audio: default **not bridged** (Chrome muted)
  - Optional **audio bridge**: HTML `video`/`audio` via `captureStream` → PCM over WS → panel Web Audio (click to unlock). Not full system audio / DRM.

## Limits

- Proxy is not a full Chromium substitute
- Browser engine needs host Chrome; CPU/RAM limited
- Audio bridge only captures document media elements that expose audio tracks
- No guarantee of bypassing site bot protection

## Verification

```bash
# Unit + integration (proxy path; no Chrome required)
pnpm --filter @ysk/core exec vitest run src/host-browse

# Docs + unit gate script
bash scripts/e2e-host-browse.sh
```

## Related

[product-page-map](../product-page-map.md)
