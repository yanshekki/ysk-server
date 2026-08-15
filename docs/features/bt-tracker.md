# BT Tracker & WebTorrent file shares

> Language: English | [中文](./bt-tracker-ZH.md)

## Purpose

Self-hosted **BitTorrent tracker** ([bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)) and **in-process WebTorrent seeder** so file shares can offer **direct HTTP**, **BT/WebTorrent**, or **both**. Each BT share gets a `.torrent` + magnet; the panel seeder announces to the local tracker; guests use the public share page or external clients.

**Non-goals:** Open public tracker for arbitrary third-party swarms; DHT-only primary path; replacing a CDN; shipping qBittorrent / Transmission / aria2.

The **library** is a local WebTorrent client: the operator adds a `.torrent` (or magnet) and a Files save folder. Missing pieces download; complete trees seed. Extra announce URLs (Trackers tab) are merged onto that client — they do **not** turn the local tracker into an open public tracker.

## Panel

| Item | Value |
|------|--------|
| Route | `/bt-tracker` |
| Related | `/files` (share modes + BT columns), public `/share/:token` |
| Tabs | Overview · Torrents (library) · Trackers (extra announce) · Settings · About |
| Capability | Files / system plane |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Status / announce URLs | `ysk-server bt-tracker status` | read | Bundled — always available |
| Start / stop | `ysk-server bt-tracker start\|stop [--execute]` | write-host | Panel: in-process. CLI start: detached worker + pid. **Start** syncs UFW desired ports (`ysk-svc:bt-tracker:*`); **stop** removes them |
| Settings | `ysk-server bt-tracker settings get\|set …` | write-panel | Persists JSON + desired exposure ports. **Listen ports need restart** if already running |
| Re-seed | `ysk-server bt-tracker restore` | write-panel | Also on `serve` boot |
| Swarm table | `ysk-server bt-tracker torrents` | read | Prefer live in-process swarm |
| Jobs | `ysk-server bt-tracker jobs [--id ID]` | read | Large-share create-torrent queue |
| Add library torrent | `ysk-server bt-tracker add --file FILE\|--magnet URI --root public --path DIR` | write-panel | Persists; WebTorrent runs in `serve` |
| Library list / pause / resume / remove | `library` · `pause` · `resume` · `remove [--delete-files]` | write-panel | |
| Extra trackers | `bt-tracker trackers add\|remove\|enable\|disable --url URL` | write-panel | Merged into WebTorrent announce |
| Create BT share | `ysk-server files shares create --mode bt\|both …` | write-panel | `.torrent` + seed |
| Share BT stats | `ysk-server files shares bt-stats --id ID` | read | Seeds / leechers / speeds |

## Library (download / seed)

Panel **Torrents** tab is a WebTorrent **library**, not only a swarm table.

1. **Add torrent** — drop or choose a `.torrent` (≤ 8 MiB), or paste a magnet.  
2. Inspect shows name, size, file list, and how many extra trackers will be used.  
3. Pick a **Files** folder (`public` or `project:<id>`). Default `public/downloads/<name>`. No arbitrary host paths.  
4. **Start** — missing pieces download into that folder; complete trees seed.  
5. Pause / resume / open folder / remove (keep files or delete them). File-share seeds stay listed and tagged **Share**.

CLI `add` **writes the library row only**. Download/seed runs inside `ysk-server serve` (panel). `restore` / serve boot resumes non-paused items.

## Extra trackers

Panel **Trackers** tab (`?tab=tracker`) is an operator announce list (`extraTrackers` in settings). Empty by default — no canned public URLs.

- Allowed: `http://` `https://` `udp://` `ws://` `wss://`. Max 32. Duplicates ignored.  
- Merged onto library add/resume **in addition to** the `.torrent` / magnet announce list.  
- Share seeder still announces **once** to the local loopback tracker (honest seed count) **and** to enabled extra URLs so off-host peers can find it.  
- Extra URLs are **not** written into public share magnets (`publicAnnounceHost` only).  
- After editing, **Apply to current seeds** updates live items; new adds always use the saved list.

```bash
ysk-server bt-tracker trackers
ysk-server bt-tracker trackers add --url http://tracker.example/announce
```

## CLI quick start

```bash
ysk-server bt-tracker settings set \
  --http-port 8000 --udp-port 6969 \
  --public-host example.com --ws --autostart --json

export YSK_EXECUTE=1
ysk-server bt-tracker start --execute --json

# Existing files → public share + seed
ysk-server files shares create --path big.zip --mode both --root public --json

# Import a .torrent (persist). Open the panel / serve to download or seed.
ysk-server bt-tracker add --file ./film.torrent --root public --path downloads/film --json
ysk-server bt-tracker library --json
ysk-server bt-tracker trackers add --url udp://tracker.example:6969 --json

ysk-server bt-tracker torrents --json
ysk-server files shares bt-stats --id SHARE_ID --json
ysk-server bt-tracker jobs --json
```

## Day-N checklist

Automated:

```bash
pnpm e2e:bt-tracker
```

Manual:

1. `ysk-server serve`  
2. BT Tracker → set **public host** + ports → **Start** (or autostart)  
3. **Network access** (panel strip): not “private only” if guests are off-host; open **8000/tcp** (and UDP if enabled)  
4. **Torrents** → Add torrent → choose save folder → confirm progress then **Seeding**; files appear under Files  
5. Optional: **Trackers** tab → add announce URLs → Apply to current seeds  
6. Files → share → **BT** or **both** (separate from library import)  
7. Open `/share/:token` → browser WebTorrent / magnet / `.torrent`  
8. Large share creates may show **jobs** while hashing  

## HTTP API

Auth: Bearer. Prefix: `/api/v1/system/bt-tracker`.

| Method | Path | Role |
|--------|------|------|
| GET | `/status` `/settings` `/torrents` `/jobs` | read |
| POST | `/start` `/stop` `/restore` | mutate tracker / re-seed |
| PATCH | `/settings` | includes `extraTrackers` |
| POST | `/library/inspect` | parse `.torrent` (base64) or magnet — no download (body up to 12 MiB) |
| POST | `/library` | add (`saveRoot`, `saveRelPath`) — starts WebTorrent in `serve` |
| GET | `/library` `/library/:id` | live progress |
| POST | `/library/:id/pause` `/library/:id/resume` | |
| DELETE | `/library/:id?deleteFiles=0\|1` | |
| POST | `/library/apply-trackers` | push extra URLs onto live seeds |

Public guest tracker proxy stays `/api/v1/public/bt-tracker` (no auth).

## Ports & announce

| Port / path | Role |
|-------------|------|
| **8000** (default) | Tracker HTTP + WS (`/announce`, WebSocket) |
| UDP optional (e.g. **6969**) | Classic UDP announce |
| **6881–6889** | Seeder peer listen range (firewall catalog) |
| **`/api/v1/public/bt-tracker`** | **Same-origin WS/HTTP proxy** into the local tracker (HTTPS share pages must use this; mixed-content blocks `ws://host:8000`) |

- Magnets / announce lists use **`publicAnnounceHost` + panel ports** only.  
- If public host is **empty**, magnets get **no** tracker URLs (do not invent `127.0.0.1` for public clients).  
- Seeder process announces **once** to the local tracker (avoids double seed counts).  
- Browser WebTorrent loads a **self-hosted** `webtorrent.min.js` asset from the panel build (not a third-party CDN), with `announce` forced to the same-origin proxy.

## Honesty

- Tracker is a **Node process** in the control plane / worker — not an apt package.  
- Panel Start keeps tracker in the **serve** process (same seeder). CLI Start prefers a **detached worker**.  
- `serve` boot runs `restoreBtSharesOnBoot` when `autostart` or BT shares exist, then restores non-paused **library** items.  
- Without a running tracker, `.torrent` may still be written, but peer discovery is weak. Third-party torrents still use their own announce list plus extra trackers.  
- Changing ports while running requires **stop → start**.  
- Library dest is Files sandbox only. Engine is bundled **WebTorrent** — not qBittorrent / Transmission / aria2.  
- CLI `add` does not download in the CLI process (that process exits).  
- Extra trackers default empty; the product does not ship a recommended public list.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Public share UX (mode buttons, progress, stats) | Guest HTTP |
| Browser WebTorrent download | Guest; asset is panel-built, tracker via same-origin proxy |

## Related

- [Files & FTP](./files-ftp.md)  
- [CLI reference](../cli/reference.md)  
- [WebTorrent](https://github.com/webtorrent/webtorrent) · [bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)
