# HTTP API overview

> Language: English | [中文](./overview-ZH.md)

Base: `/api/v1/…` on the `serve` listener. Auth: `Authorization: Bearer <session-or-ysk-key>`.

Locale: `Accept-Language` or `?locale=`.

Ops mutations return honest `OpsResultDto` bodies. Prefer CLI for agents.

Full OpenAPI is not published. Inventory: `docs/cli/control-plane-inventory.json` (`node scripts/cli-panel-parity.mjs`).

## Groups

| Panel | CLI | API prefix |
|-------|-----|------------|
| `/login` | — | `/api/v1/auth` |
| `/projects` | `projects` | `/api/v1/projects` |
| `/email` | `email` | `/api/v1/email` |
| `/files` | `files` | `/api/v1/files` |
| `/ftp` | `ftp` | `/api/v1/ftp` |
| `/bt-tracker` | `bt-tracker` | `/api/v1/bt-tracker` |
| `/dns` | `dns` | `/api/v1/dns` |
| `/ssl` | `ssl` | `/api/v1/ssl` |
| `/nginx` | `nginx` | `/api/v1/nginx` |
| `/apache` | `apache` | `/api/v1/apache` |
| `/cdn` | `cdn` | `/api/v1/cdn` |
| `/databases/*` | `db` · `redis` | `/api/v1/resources` · `/api/v1/redis` |
| `/runtimes/*` | `runtimes` | `/api/v1/hosting/runtimes` |
| `/protection` | `defense` | `/api/v1/defense` |
| `/security` | `security` | `/api/v1/security` |
| `/vpn` | `vpn` | `/api/v1/vpn` |
| `/vnc` | `vnc` | `/api/v1/vnc` |
| `/users` | `users` | `/api/v1/users` |
| `/services` | `services` | `/api/v1/system` |
| `/network` | `network` | `/api/v1/network` |
| `/browse` | — (panel-only) | `/api/v1/host-browse` |
| `/logs` | `logs` | `/api/v1/logs` |
| `/cron` | `cron` | `/api/v1/cron` |
| `/backups` | `backup` | `/api/v1/backups` |
| `/system/migrate` | `migrate` | `/api/v1/system/migrate` |
| `/updates` | `updates hub` | `/api/v1/updates` |
| `/system/readiness` | `readiness` | `/api/v1/readiness` |
| `/share/:token` | — (public) | `/api/v1/public` |

Files name collisions: `ifExists=fail|overwrite|rename` on upload/copy/rename (default **fail**).

`POST /api/v1/projects` optional `createDnsZone` / `createMailDomain` (plus `serverIp` / `serverIpv6`) write DNS and mail **drafts**. Same flags on CLI: `--create-dns` / `--create-mail`. Not live authoritative DNS or a provisioned mailbox.

`POST /api/v1/projects/:id/ftp` creates a jailed FTPS account (`homeSubdir` `app`|`root`). CLI: `ysk-server projects ftp` or `ftp accounts create --project`. Apply vsftpd on `/ftp`.

`PATCH /api/v1/email/domains/:id/flags` sets vacation (`autoreply*`) and catch-all. CLI: `ysk-server email flags` / `email aliases create --type catchall`. Draft until `--execute`.

`GET /api/v1/email/queue` is a read probe (`postqueue -p`, parsed rows). `POST /api/v1/email/queue/flush` needs EXECUTE. Panel: `/email?tab=queue`.

`GET /api/v1/notifications` is the dashboard alert bar. CLI: `ysk-server notifications`.
