# HTTP API 概覽

> 語言：香港書面語 | [English](./overview.md)

基底：`serve` 監聽上的 `/api/v1/…`。認證：`Authorization: Bearer <session 或 ysk 金鑰>`。

語系：`Accept-Language` 或 `?locale=`。

變更回傳誠實 `OpsResultDto`。自動化與 agent 請優先使用 CLI，不要自行發明路徑。

未發布完整 OpenAPI。清單見 `docs/cli/control-plane-inventory.json`（執行 `node scripts/cli-panel-parity.mjs`）。下表列出面板頁、對應 CLI 指令，以及 HTTP 前綴，方便對齊三個控制面。

## 分組

| 面板 | CLI | API 前綴 |
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
| `/browse` | —（僅限面板） | `/api/v1/host-browse` |
| `/logs` | `logs` | `/api/v1/logs` |
| `/cron` | `cron` | `/api/v1/cron` |
| `/backups` | `backup` | `/api/v1/backups` |
| `/system/migrate` | `migrate` | `/api/v1/system/migrate` |
| `/updates` | `updates hub` | `/api/v1/updates` |
| `/system/readiness` | `readiness` | `/api/v1/readiness` |
| `/share/:token` | —（公開） | `/api/v1/public` |

檔案撞名：上載／複製／重新命名使用 `ifExists=fail|overwrite|rename`（預設 **fail**）。

`POST /api/v1/projects` 可選 `createDnsZone`／`createMailDomain`（另加 `serverIp`／`serverIpv6`）只寫 DNS 與郵件**草稿**。CLI 對應 `--create-dns`／`--create-mail`。不等於權威 DNS 已上線，亦不會即時開好郵箱。

`POST /api/v1/projects/:id/ftp` 建立路徑 Jail 的 FTPS 帳戶（`homeSubdir` 為 `app` 或 `root`）。CLI：`ysk-server projects ftp` 或 `ftp accounts create --project`。要套用 vsftpd 請到 `/ftp`。

`PATCH /api/v1/email/domains/:id/flags` 設定假期自動回覆（`autoreply*`）與 Catch-all。CLI：`ysk-server email flags`／`email aliases create --type catchall`。未加 `--execute` 只寫草稿。

`GET /api/v1/email/queue` 為讀取探測（`postqueue -p`，已解析列）。`POST /api/v1/email/queue/flush` 需 EXECUTE。面板：`/email?tab=queue`。
