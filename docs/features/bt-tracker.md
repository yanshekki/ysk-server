# BT Tracker & WebTorrent file shares

> Language: English | [中文](./bt-tracker-ZH.md)

## Purpose

Self-hosted **BitTorrent tracker** ([bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)) and **in-process WebTorrent seeder** so file shares can offer **direct HTTP**, **BT/WebTorrent**, or **both**. Each BT share gets a `.torrent` + magnet; the panel seeder announces to the local tracker; guests use the public share page or external clients.

**Non-goals:** Open public tracker for arbitrary third-party torrents; DHT-only primary path; replacing a CDN.

## Panel

| Item | Value |
|------|--------|
| Route | `/bt-tracker` |
| Related | `/files` (share modes + BT columns), public `/share/:token` |
| Tabs | Overview · Torrents (+ jobs when non-empty) · Settings · About |
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
| Create BT share | `ysk-server files shares create --mode bt\|both …` | write-panel | `.torrent` + seed |
| Share BT stats | `ysk-server files shares bt-stats --id ID` | read | Seeds / leechers / speeds |

## CLI quick start

```bash
ysk-server bt-tracker settings set \
  --http-port 8000 --udp-port 6969 \
  --public-host example.com --ws --autostart --json

export YSK_EXECUTE=1
ysk-server bt-tracker start --execute --json

ysk-server files shares create --path big.zip --mode both --root public --json

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
4. Files → share → **BT** or **both**  
5. Open `/share/:token` → browser WebTorrent / magnet / `.torrent`  
6. Confirm swarm numbers on Torrent tab; large files may show jobs while hashing  

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
- `serve` boot runs `restoreBtSharesOnBoot` when `autostart` or BT shares exist.  
- Without a running tracker, `.torrent` may still be written, but peer discovery is weak.  
- Changing ports while running requires **stop → start**.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Public share UX (mode buttons, progress, stats) | Guest HTTP |
| Browser WebTorrent download | Guest; asset is panel-built, tracker via same-origin proxy |

## Related

- [Files & FTP](./files-ftp.md)  
- [CLI reference](../cli/reference.md)  
- [WebTorrent](https://github.com/webtorrent/webtorrent) · [bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)
