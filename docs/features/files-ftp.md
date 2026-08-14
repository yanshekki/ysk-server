# Files, WebDAV & FTP

> Language: English | [中文](./files-ftp-ZH.md)

## Purpose

Sandboxed **file manager** (public or project root), **public share links** (direct HTTP and/or **BitTorrent / WebTorrent**), **WebDAV**, and **FTPS accounts** / vsftpd service.

**Non-goals:** Unrestricted host filesystem browse as a remote SSH product; public share landing is panel HTTP (create is CLI/API).

## Panel

| Item | Value |
|------|--------|
| Routes | `/files`, `/ftp`, `/bt-tracker`, public `/share/:token` |
| Nav keys | `files`, `publicFiles`, `ftp`, `btTracker` |
| Main actions | CRUD · trash · shares (mode direct/BT/both) · favorites · WebDAV · FTPS · BT tracker |
| Capability | Files / FTPS |
| RBAC | File and FTP operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| List/read/write/mkdir/rm/… | `ysk-server files list\|read\|write\|… --root public\|project:ID` | write-panel | |
| Trash | `ysk-server files trash list\|restore\|purge` | write-panel | |
| Shares list | `ysk-server files shares list` | read | |
| Share create/delete | `ysk-server files shares create\|delete [--mode direct\|bt\|both]` | write-panel | BT creates `.torrent` + seeder |
| Share BT stats | `ysk-server files shares bt-stats --id ID` | read | Seeds / peers / speeds |
| Upload local file | `ysk-server files upload --dir … --file … [--if-exists fail\|overwrite\|rename]` | write-panel | Default **fail** (409); panel asks first |
| Copy / move / rename collision | `… --if-exists fail\|overwrite\|rename` | write-panel | Same as `POST /api/v1/files/copy` |
| WebDAV | `ysk-server files webdav status\|token\|disable` | write-panel | |
| FTP status/settings | `ysk-server ftp status\|settings …` | read / write-panel | |
| FTP accounts CRUD | `ysk-server ftp accounts list\|create\|update\|delete` | write-panel | `--project ID` jails to that site |
| Project FTP | `ysk-server projects ftp --id UUID --password P` | write-panel | Same as `POST /api/v1/projects/:id/ftp` |
| FTP apply to host | `ysk-server ftp apply\|accounts apply --execute` | write-host | |
| BT tracker | `ysk-server bt-tracker status\|start\|stop\|settings\|torrents\|restore\|jobs` | read / write-host | See [bt-tracker.md](./bt-tracker.md) |
| Public files site | `ysk-server hosting public-files …` | write-host | |

## CLI quick start

```bash
ysk-server files list --root public --json
ysk-server files shares create --path docs --root public --json
ysk-server files shares create --path big.zip --mode both --root public --json
ysk-server bt-tracker start --execute --json
ysk-server ftp accounts list --json
export YSK_EXECUTE=1
ysk-server ftp apply --execute --json
```

## Honesty

- File ops are sandboxed to chosen root.  
- FTPS apply needs EXECUTE + root for vsftpd.
- vsftpd start/stop/restart: panel service tab, or `ysk-server services stop vsftpd --execute`.  
- Public `/share/:token` page is UX; **create** is CLI/API. Password-protected shares send `X-Share-Password` (never `?password=`). After a correct password the page re-fetches meta so magnet / in-browser BT unlock.  
- BT mode needs tracker running for peer discovery; set `publicAnnounceHost` for off-host magnets. Browser WebTorrent uses a same-origin tracker proxy (`/api/v1/public/bt-tracker`) and a panel-built WebTorrent asset (not a public CDN).
- Name collisions: panel dialog (skip / keep both / replace / merge). CLI/API default `--if-exists fail`. `files write` still overwrites.

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| In-browser preview editor | Use `files read/write` |
| Public share landing page | Public HTTP |
| Conflict dialog UX | CLI/API use `--if-exists` instead |

## Related

- [BT Tracker & WebTorrent shares](./bt-tracker.md)  
- [CLI reference — files / ftp / bt-tracker](../cli/reference.md)  
- [Panel ↔ CLI matrix](../cli/panel-parity-matrix.md)  
