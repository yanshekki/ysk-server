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

Inbound Git hook（無需登入）：`POST /api/v1/hooks/git/:id`。認證用專案 secret——`X-YSK-Git-Hook`、`X-Gitlab-Token`，或 HMAC（`X-Hub-Signature-256`／`X-Gitea-Signature`）。管理（需登入、`projects.write`）：`POST /api/v1/projects/:id/git/hook` `{ action: enable|rotate|disable }`。其他 Git 控制：`GET /api/v1/projects/:id/git` · `/git/log`，`POST …/git/fetch|checkout|reset|auth`。CLI：`ysk-server projects git`。ping／其他事件／其他分支的 push 回 `200 { skipped }`。真正 clone 仍需 `YSK_EXECUTE=1`。

`PATCH /api/v1/email/domains/:id/flags` 設定假期自動回覆（`autoreply*`）與 Catch-all。CLI：`ysk-server email flags`／`email aliases create --type catchall`。未加 `--execute` 只寫草稿。

`GET /api/v1/email/queue` 為讀取探測（`postqueue -p`，已解析列）。`POST /api/v1/email/queue/flush` 需 EXECUTE。面板：`/email?tab=queue`。

`GET /api/v1/notifications` 為儀表板提示條。CLI：`ysk-server notifications`。

`POST /api/v1/backups/remote/test` 探測 SFTP／S3／local 目的地。本文可覆寫未儲存表單（不會寫入設定）。SFTP 使用出站身分。CLI：`ysk-server backup settings test`。實際探測需 EXECUTE。缺金鑰／密碼不是未開 EXECUTE。

`POST /api/v1/backups/control-plane/restore` 且 `mode: dry-run` 會列出封存（`tar -tzf`），不需專案列。CLI：`ysk-server backup restore --project-id control-plane`。

`POST /api/v1/system/migrate/orphan-homes` `{ path, confirmPath }` 刪除殘留 `/home/ysk-server-<uuid>`（需確認 + EXECUTE）。清冊含 `orphanHomes`。CLI：`ysk-server migrate orphan-homes`。

`POST /api/v1/db/remote-hosts/:id/test` 為 TCP 可達性檢查（面板「測試連線」）。

`POST /api/v1/email/domains/:id/policy` 設定每域反垃圾與出站限速（Rspamd 對應表）。CLI：`ysk-server email policy`。加 `--execute` 才複製到 `/etc`。

面板用戶 2FA：`GET/POST /api/v1/settings/security` 的 `requireUserTotp`。CLI：`ysk-server users totp`／`users totp-clear`。用戶到 `/security` 自行登記。

`GET /api/v1/updates/self` 為面板版本檢查。`POST /api/v1/updates/self/apply` 把官方 npm tarball overlay 到執行中目錄（等同 `ysk-server update --apply`）。套用失敗回 **422**，`blockMessage`／`message` 為真正原因，不會把 `npm notice` 檔案清單當錯誤。覆寫產品自己的檔案不需要 `YSK_EXECUTE`。

Nginx 站點套用（`POST /api/v1` nginx／受管資源）在 `serverName` 空白或非法時 **直接失敗**。回傳 `ok: false` 與驗證訊息，**不會**寫入 `server_name localhost`。CLI：`ysk-server nginx`／`ysk-server hosting nginx`。

BT Tracker 資料庫（程序內 WebTorrent）：`POST /api/v1/system/bt-tracker/library/inspect` 與 `POST /api/v1/system/bt-tracker/library` 接受 `torrentBase64` 或 `magnet`，以及 `saveRoot`／`saveRelPath`（Files 沙箱）。inspect／add 本文上限 **12 MiB**。CLI：`ysk-server bt-tracker add|library|inspect`。常用 announce 為 `PATCH /api/v1/system/bt-tracker/settings` 的 `extraTrackers`，或 `ysk-server bt-tracker trackers`。訪客代理仍是 `/api/v1/public/bt-tracker`。

JSON 請求正文有上限（預設 1 MiB；`POST /api/v1/auth/login` 為 256 KiB）。超限回 **413**。登入 JSON 無效回 **400**。

公開 VNC 分享：`GET /api/v1/vnc/share/:token` 與 `POST /api/v1/vnc/share/:token/session` 無需登入（有速率限制）。建立分享（`POST /api/v1/vnc/share`）仍需 `network.vnc`，回傳路徑 `/vnc-share/:token`。

公開檔案分享只以 `X-Share-Password` 傳送解鎖密碼（不用 `?password=`）。密碼正確後，`GET /api/v1/public/shares/:token/meta` 才會回 magnet／torrent 欄位。

`GET /api/v1/email/domains/:id` 回傳單一網域。`POST /api/v1/terminal/` 接受 `settings.system` **或** `services.control`。

用戶 PATCH／DELETE 不能暫停、降級或刪除目前登入帳戶，也不能對最後一個管理員這樣做。
