# Nginx sites

> [中文](./nginx-sites-ZH.md)

## Purpose

**SSOT** for Nginx: `/nginx` lists project + standalone sites. Apply, preview, global/site settings live here — not on the project Network tab.

## Project network

Project → Network: domain / port meta only. Use **Manage in Nginx** for apply.

## Settings

- **Global**: gzip, server_tokens, body size, keepalive, access log
- **Site**: SSL, force HTTPS, HSTS, body size, CF Real IP, indexes

## API

| Method | Path |
|--------|------|
| GET | `/api/v1/hosting/nginx/sites` |
| POST | `/api/v1/hosting/nginx/sites/:id/apply` |
| GET | `.../conf` |
| GET/PATCH | `/api/v1/hosting/nginx/settings` |
| POST | `.../settings/apply` |
| PATCH | `.../sites/:id/settings` |
