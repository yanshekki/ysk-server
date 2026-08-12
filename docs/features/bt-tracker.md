# BT Tracker & WebTorrent file shares

> Language: English | [中文](./bt-tracker-ZH.md)

## Purpose

Self-hosted **BitTorrent tracker** ([bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)) and **in-process WebTorrent seeder** so file shares can offer **direct HTTP download**, **BT/WebTorrent**, or **both**. Creates a `.torrent` per share, announces peers via the panel tracker, and exposes live swarm stats on the panel and public `/share/:token` page.

**Non-goals:** A full public open tracker for arbitrary third-party torrents; DHT-only sharing without a local tracker; replacing commercial CDN.

## Panel

| Item | Value |
|------|--------|
| Route | `/bt-tracker` |
| Related | `/files` (share dialog modes + BT stats), public `/share/:token` |
| Nav key | `btTracker` |
| Main tabs | Overview · Torrents table · Settings · About |
| Capability | Files / system (same plane as files) |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Status / announce URLs | `ysk-server bt-tracker status` | read | Bundled dependency — always “installed” |
| Start / stop tracker | `ysk-server bt-tracker start\|stop [--execute]` | write-host | Panel in-process; CLI detached worker |
| Re-seed shares | `ysk-server bt-tracker restore` / panel **Re-seed** | write-panel | Also runs on `serve` boot |
| Settings (ports, public host, WS, autostart) | `ysk-server bt-tracker settings get\|set …` | write-panel | Firewall open is separate (exposure / UFW) |
| Torrents / swarm table | `ysk-server bt-tracker torrents` | read | Live swarm + share/seeder hints |
| Create BT share | `ysk-server files shares create --mode bt\|both --path …` | write-panel | Builds `.torrent` + seeds; piece length auto-scales |
| Share BT stats | `ysk-server files shares bt-stats --id ID` | read | Seeds / leechers / speeds |

## CLI quick start

```bash
# Configure public announce host peers will dial
ysk-server bt-tracker settings set --http-port 8000 --public-host example.com --json

# Start tracker (production: EXECUTE)
export YSK_EXECUTE=1
ysk-server bt-tracker start --execute --json

# Share a file with BT + direct
ysk-server files shares create --path big.zip --mode both --root public --json

# Live stats
ysk-server bt-tracker torrents --json
ysk-server files shares bt-stats --id SHARE_ID --json
```

## Day-N e2e checklist

1. `ysk-server serve` (panel up).  
2. Panel **BT Tracker** → set public host → **Start** (or enable autostart, restart serve).  
3. Network exposure / firewall: open **8000** if peers are off-host.  
4. **Files** → share a file → mode **both** → copy public link.  
5. Open `/share/:token` → **Download in browser (WebTorrent)** or magnet / `.torrent`.  
6. Panel torrent table / share list shows seeds / peers / speeds.  
7. Restart serve → confirm tracker + seeder restore (boot re-seed).

## Ports

| Port | Role |
|------|------|
| **8000** (default) | HTTP + WebSocket announce (`/announce`, WS for browser WebTorrent) |
| UDP (optional, default off) | Classic UDP tracker |
| **6881–6889** | Seeder peer listen range (catalog: firewall chips) |

Use **Network exposure** on the BT Tracker page / firewall chips (`8000 BT tracker`, `6881-6889 BT peers`). Prefer private mode unless downloaders are on the public Internet.

## Honesty

- Tracker is an **in-process Node service** inside the control plane (`ysk-server serve`), not a separate apt package.  
- **Panel Start/Stop** and **autostart** keep the tracker alive with the panel process. One-shot CLI `bt-tracker start` only lasts for that CLI process — prefer panel or `autostart` for production.  
- On **`ysk-server serve` boot**, the control plane calls `restoreBtSharesOnBoot`: starts the tracker when `autostart` is on **or** BT shares exist, then re-seeds shares that still have a `.torrent` on disk (skips `seedStatus: stopped`).  
- BT shares without a running tracker still create `.torrent` files but peers may not discover each other until announce works.  
- `publicAnnounceHost` empty ⇒ magnets use `127.0.0.1` — fine for same-host tests only.  
- EXECUTE preferred for production starts; local listen may still succeed without it.

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Public share BT UI (magnet / .torrent / stats) | Guest HTTP |
| Browser WebTorrent download | Guest loads WebTorrent from CDN on demand; server still seeds |

## Related

- [Files & FTP](./files-ftp.md)  
- [CLI reference — files / bt-tracker](../cli/reference.md)  
- [WebTorrent](https://github.com/webtorrent/webtorrent) · [webtorrent-cli](https://github.com/webtorrent/webtorrent-cli) · [bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)  
