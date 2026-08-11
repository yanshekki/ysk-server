# Apache

> [中文](./apache-ZH.md)

## Purpose

Manage **Apache** vhosts and settings on `/apache` (SSOT). Project pages do not publish Apache.

## UI

- Create site: proxy / static / PHP
- Apply → configtest + reload (needs `YSK_EXECUTE`)
- Global settings · site settings (checkboxes / radio chips)

## API

| Method | Path |
|--------|------|
| GET/POST | `/api/v1/hosting/apache/sites` |
| PATCH/DELETE | `/api/v1/hosting/apache/sites/:id` |
| POST | `.../apply` |
| GET/PATCH | `/api/v1/hosting/apache/settings` |
| POST | `.../settings/apply` |

## Related

- [Nginx](./nginx.md) — reverse proxy SSOT for projects
