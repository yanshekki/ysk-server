# Apache

> [中文](./apache-ZH.md)

## Purpose

Manage **Apache** vhosts and settings on `/apache` (SSOT). Project pages do not publish Apache.

## UI

- Create site: proxy / static / PHP
- Apply → configtest + reload (needs `YSK_EXECUTE`)
- Global settings · site settings (checkboxes / radio chips)
- **Sources**: project · standalone · **on disk (artifact)** — unclaimed conf under `dataDir/apache/sites`
- **Name conflict** badge when the same `ServerName` appears more than once
- Artifact rows: **Preview conf** · **Remove residual** (never edit as a second SSOT)
- Toolbar **Clean conflict residuals** when any artifact conflicts with an owned row

## SSOT & orphans

| Source | Authority | Sync to system |
|--------|-----------|----------------|
| Project (PHP) | Project domain + `ysk-{linuxUser}.conf` | Yes (owned) |
| Standalone | `sites.json` | Yes (owned) |
| Artifact | Discovery only | **No** (not pushed on sync) |

Removing an artifact deletes the managed conf and, with execute/root, disables the system twin (`ysk-{file}`). Applying a PHP project also **retires** other dataDir confs with the same `ServerName` (not owned by another live project).

## API

| Method | Path |
|--------|------|
| GET/POST | `/api/v1/hosting/apache/sites` |
| PATCH/DELETE | `/api/v1/hosting/apache/sites/:id` — `DELETE artifact:…` removes residual |
| POST | `.../apply` |
| POST | `/api/v1/hosting/apache/sites/cleanup-conflicts` |
| GET/PATCH | `/api/v1/hosting/apache/settings` |
| POST | `.../settings/apply` |

## Related

- [Nginx](./nginx.md) — reverse proxy SSOT for projects
