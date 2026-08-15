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
| `/bt-tracker` | `bt-tracker` | `/api/v1/system/bt-tracker` |
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

Inbound Git hook (no session): `POST /api/v1/hooks/git/:id`. Auth is the project secret — `X-YSK-Git-Hook`, `X-Gitlab-Token`, or HMAC (`X-Hub-Signature-256` / `X-Gitea-Signature`). Manage (session, `projects.write`): `POST /api/v1/projects/:id/git/hook` `{ action: enable|rotate|disable }`. Other Git control: `GET /api/v1/projects/:id/git` · `/git/log`, `POST …/git/fetch|checkout|reset|auth`. CLI: `ysk-server projects git`. Ping / other events / wrong-branch pushes return `200 { skipped }`. Clone still needs `YSK_EXECUTE=1`.

`PATCH /api/v1/email/domains/:id/flags` sets vacation (`autoreply*`) and catch-all. CLI: `ysk-server email flags` / `email aliases create --type catchall`. Draft until `--execute`.

`GET /api/v1/email/queue` is a read probe (`postqueue -p`, parsed rows). `POST /api/v1/email/queue/flush` needs EXECUTE. Panel: `/email?tab=queue`.

`GET /api/v1/notifications` is the dashboard alert bar. CLI: `ysk-server notifications`.

`POST /api/v1/backups/remote/test` probes SFTP/S3/local destination. Body may overlay unsaved form values (does not persist). SFTP uses the outbound identity. CLI: `ysk-server backup settings test`. Live probe needs EXECUTE. Missing key/password is not EXECUTE-off.

`POST /api/v1/backups/control-plane/restore` with `mode: dry-run` lists the archive (`tar -tzf`) without a project row. CLI: `ysk-server backup restore --project-id control-plane`.

`POST /api/v1/system/migrate/orphan-homes` `{ path, confirmPath }` deletes leftover `/home/ysk-server-<uuid>` (confirm + EXECUTE). Inventory includes `orphanHomes`. CLI: `ysk-server migrate orphan-homes`.

`POST /api/v1/db/remote-hosts/:id/test` is a TCP reachability check (panel Test connection).

`POST /api/v1/email/domains/:id/policy` sets per-domain antispam + outbound rate (Rspamd map). CLI: `ysk-server email policy`. `--execute` copies into `/etc`.

Panel-user 2FA: `GET/POST /api/v1/settings/security` `requireUserTotp`. CLI: `ysk-server users totp` / `users totp-clear`. Each user enrolls on `/security`.

`GET /api/v1/updates/self` is the panel version check. `POST /api/v1/updates/self/apply` overlays the official npm tarball onto the running dest (same as `ysk-server update --apply`). Failed apply returns **422** with `blockMessage` / `message` — never an `npm notice` file listing. Overlay of own package files does not require `YSK_EXECUTE`.

Nginx site apply (`POST /api/v1` nginx / managed resources) **fails closed** on empty or invalid `serverName`. The response is `ok: false` with a validation message — it does not write `server_name localhost`. CLI: `ysk-server nginx` / `ysk-server hosting nginx`.

BT Tracker library (in-process WebTorrent): `POST /api/v1/system/bt-tracker/library/inspect` and `POST /api/v1/system/bt-tracker/library` accept a `.torrent` as `torrentBase64` or a `magnet`, plus `saveRoot` / `saveRelPath` (Files sandbox). Inspect/add bodies allow up to **12 MiB**. CLI: `ysk-server bt-tracker add|library|inspect`. Extra announce list is `PATCH /api/v1/system/bt-tracker/settings` `extraTrackers`, or `ysk-server bt-tracker trackers`. Guest proxy remains `/api/v1/public/bt-tracker`.

JSON request bodies are capped (default 1 MiB; `POST /api/v1/auth/login` 256 KiB). Oversize → **413**. Invalid login JSON → **400**.

Public VNC share: `GET /api/v1/vnc/share/:token` and `POST /api/v1/vnc/share/:token/session` are unauthenticated (rate-limited). Create share (`POST /api/v1/vnc/share`) still needs `network.vnc` and returns path `/vnc-share/:token`.

Public file shares send the unlock password only as `X-Share-Password` (never `?password=`). After a correct password, `GET /api/v1/public/shares/:token/meta` returns magnet / torrent fields.

`GET /api/v1/email/domains/:id` returns one domain. `POST /api/v1/terminal/` accepts `settings.system` **or** `services.control`.

User PATCH/DELETE cannot suspend, demote, or delete the signed-in account or the last admin.
