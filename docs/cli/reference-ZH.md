# CLI 參考

> 語言：中文 | [English](./reference.md)

**二進位：** `ysk-server`  
**另見：** [overview-ZH.md](./overview-ZH.md) · [parity-ZH.md](./parity-ZH.md) · [../agent/commands.json](../agent/commands.json)

全域旗標與結束碼見 [overview-ZH.md](./overview-ZH.md)。

除另有說明外，可按需加上 `--json`、`--data-dir PATH`。大型 JSON 列表可用 `--limit N --offset N`。命令列說明預設英文（`--locale`／`YSK_LOCALE`）。

---

## setup

初始化 `dataDir`、設定、document store、管理員、systemd unit 範本。

```bash
ysk-server setup --data-dir /var/lib/ysk [--admin-username U] [--admin-password P] [--listen-host 127.0.0.1] [--listen-port 9287] [--locale zh-HK] [--dry-run] [--force] [--json]
```

弱密碼／預設密碼會被拒絕，除非本機開發設 `YSK_ALLOW_INSECURE_DEFAULTS=1`。

## serve

啟動 HTTP API + 靜態 Web UI（需已建置 `apps/web`）。

```bash
ysk-server serve [--config PATH] [--data-dir PATH] [--host 127.0.0.1] [--port 9287] [--web-root PATH]
```

## update

檢查或套用**面板**自身更新（官方 npm 套件 `ysk-server`）。

套用會把 tarball overlay 到**執行中**安裝目錄（systemd `ExecStart` 樹，通常是 `…/apps/server` 或 `…/ysk-server`）。**不依賴** `npm install -g`（該路徑不會更新從源碼安裝的 ExecStart）。覆寫產品自己的檔案**不需要** `YSK_EXECUTE`。成功後會排程重啟服務。

若執行中面板太舊、無法自行套用：用 `install.sh --upgrade`（只 overlay 產品，不會重裝 MariaDB／MySQL）。

主機套件升級在 `/updates` 與 `ysk-server updates hub`。

```bash
ysk-server update --check --json
ysk-server update --apply --json
```

## system

```bash
ysk-server system unit-install [--enable] [--data-dir PATH] [--execute]
```

寫入控制平面 systemd unit；enable／start 需 root + EXECUTE。

## version | help

```bash
ysk-server version
ysk-server help [--locale zh-HK|zh-CN|en]
```

---

## projects

```bash
ysk-server projects list
ysk-server projects get --id UUID
ysk-server projects create --name NAME --domain D [--runtime node|php|static|…] [--git-url URL] [--branch B] [--create-dns] [--create-mail] [--server-ip A.B.C.D] [--server-ipv6 ADDR]
ysk-server projects deploy --id UUID [--entry FILE] [--port N] [--fpm] [--execute]
ysk-server projects stop --id UUID [--execute]
ysk-server projects health --id UUID
ysk-server projects backup --id UUID
ysk-server projects git-deploy --id UUID [--git-url URL] [--branch|--ref B] [--depth N] [--execute]
ysk-server projects git status|log|fetch|checkout|reset|auth|deploy --id UUID [--ref R] [--unshallow] [--yes]
ysk-server projects git auth --id UUID --token T | --deploy-key | --pin-host | --clear-token | --clear-key | --clear-host
ysk-server projects git hook --id UUID --enable|--rotate|--disable
# --enable／--rotate 之後，請自行把 hook.path + hookSecret 貼到 GitHub／Gitea／GitLab。
# 入站：POST /api/v1/hooks/git/:id（無需登入；HMAC 或 X-YSK-Git-Hook）
ysk-server projects isolation list|provision|provision-all|backfill-owners …
ysk-server projects template …
ysk-server projects ftp --id UUID --password P [--user NAME] [--home app|root]
```

部署路徑：systemd → PM2 → pidfile（Node）；FPM 或 `php -S`（PHP）；nginx root（static）。見 [../features/projects-ZH.md](../features/projects-ZH.md)。

## templates

列出／套用應用範本（node-starter、static-site、wordpress-php…）。

```bash
ysk-server templates list|apply …
```

## hosting

底層架站輔助（預設 dry-run）：

```bash
ysk-server hosting leftovers   # 唯讀；overlay 不會改寫主機檔
ysk-server hosting nginx|nginx-sync [--execute]
ysk-server hosting mysql-provision|postgres-provision|redis-provision [--execute]
ysk-server hosting dns-zone --zone X --ip A.B.C.D …
ysk-server hosting email-bootstrap|email-deliverability|email-apply …
ysk-server hosting ftps-apply|firewall-apply|runtimes|runtime-install|runtime-switch|runtime-uninstall …
```

優先使用一級 `runtimes`／`ftp`／`apache`（如適用）。完整子命令請執行 `ysk-server hosting`。

## nginx | ssl | dns

```bash
ysk-server nginx status|list|test|sync [--execute]
ysk-server ssl list|get|bootstrap|panel-tls status|enable|disable|issue …
ysk-server dns zones|zone|dnssec|heal|health|lookup|records …
```

空的或非法 Nginx `server_name` **會被拒絕**（fail-closed）。套用**不會**退回寫入 `localhost`。面板與 `POST /api/v1` nginx／資源套用同一規則。

`dns` 涵蓋託管 zone、DNSSEC、PowerDNS heal、lookup／validate。

## backup

```bash
ysk-server backup list [--q TEXT]
ysk-server backup status
ysk-server backup all
ysk-server backup restore --project-id ID --name ARCHIVE [--mode full|web|dry-run] [--target DIR]
# 控制平面預覽：--project-id control-plane（tar -tzf；不需專案列）
ysk-server backup delete …
ysk-server backup schedule [--install] [--execute]
ysk-server backup control-plane
ysk-server backup settings get|set|test [--remote-enable] [--remote-kind sftp|s3|local] [--s3-bucket …]
# test 使用表單／已存身分；真正探測需 --execute + YSK_EXECUTE=1
ysk-server backup restic …
```

## store

```bash
ysk-server store status|export|import|migrate --to json|sqlite|postgres …
```

見 [../architecture/state-store-ZH.md](../architecture/state-store-ZH.md)。

## files

沙箱檔案管理（public 或 `project:ID` 根）：

```bash
ysk-server files list|stat|read|write|mkdir|rm|rename|copy|move|chmod …
ysk-server files trash list|restore|purge
ysk-server files shares list|create|delete|bt-stats
ysk-server files upload --dir REL --file LOCAL [--if-exists fail|overwrite|rename]
ysk-server files copy|move|rename --from REL --to REL [--if-exists fail|overwrite|rename]
ysk-server files mkdir --path REL [--if-exists fail|merge|rename]
ysk-server files webdav status|token|disable
```

```bash
ysk-server files shares create --path REL [--mode direct|bt|both] [--password …] [--expires ISO] --root public
ysk-server files shares bt-stats --id SHARE_ID
ysk-server files shares delete --id SHARE_ID
```

撞名：面板會詢問（略過／兩者都保留／取代／合併）。API 與 CLI 預設 **`--if-exists fail`**（HTTP 409）。`--if-exists rename` 會存成 `name (1).ext`；`overwrite` 則覆寫。`files write`（編輯器）仍會覆寫。與 `POST /api/v1/files/upload` 相同。

`--mode bt|both` 會產生 `.torrent`、以 WebTorrent 程序內做種，並需要運行中的 Tracker（`bt-tracker start`）。公開 `/share/:token` 按模式顯示 **直接下載** 及／或 **BT**（不會再彈英文 “direct disabled”）。瀏覽器 WebTorrent 用面板 **自帶** 資源，並經同源 Tracker 代理（`/api/v1/public/bt-tracker`）。

## bt-tracker

自架 [bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)，加上程序內 **WebTorrent** 資料庫（把 `.torrent`／magnet 存到 Files 資料夾）。

```bash
ysk-server bt-tracker status|info
ysk-server bt-tracker settings get|show
ysk-server bt-tracker settings set|patch \
  [--http-port N] [--udp-port N] [--listen-host H] [--public-host H] \
  [--ws|--no-ws] [--autostart|--no-autostart]
ysk-server bt-tracker start [--execute]   # detached worker + pid（CLI 結束後仍運行）
ysk-server bt-tracker stop                # 同時清除 ysk-svc:bt-tracker UFW 規則
ysk-server bt-tracker torrents|stats      # 即時 swarm（優先程序內）
ysk-server bt-tracker restore             # 重新做種分享 + 資料庫（必要時啟動 Tracker）
ysk-server bt-tracker jobs [--id JOB_ID]  # 大型分享建 torrent 佇列
ysk-server bt-tracker inspect --file FILE.torrent|--magnet URI
ysk-server bt-tracker add --file FILE|--magnet URI --root public --path downloads/name
ysk-server bt-tracker library [--id ID]
ysk-server bt-tracker pause|resume --id ID
ysk-server bt-tracker remove --id ID [--delete-files]
ysk-server bt-tracker trackers
ysk-server bt-tracker trackers add|remove|enable|disable --url URL
```

| 主題 | 行為 |
|------|------|
| 預設埠 | HTTP／WS **8000**；UDP 可選（如 6969） |
| 公開主機 | `settings set --public-host` → magnet／announce。**空白 ⇒ 不寫公開 tracker URL**（不再假 `127.0.0.1`） |
| 啟動 | Detached worker；**`syncServiceExposure` reason=start**（HTTP + 已設 UDP） |
| 停止 | 停進程；**exposure reason=stop** |
| 停止時改設定 | 只更新 JSON + 期望埠 |
| 運行中改埠 | 可寫入，但要 **重啟 Tracker** 才 re-bind |
| 瀏覽器訪客 | 同源 **`wss?://面板/api/v1/public/bt-tracker`** 代理到本機 Tracker（HTTPS 安全） |
| serve 開機 | autostart 或已有 BT 分享 → `restoreBtSharesOnBoot` + 資料庫還原 |
| `add` | 寫入資料庫 JSON 並複製 `.torrent`。**不會**在 CLI 行程下載 — 請開 `serve`／面板 |
| `trackers` | 額外 announce URL（預設空白）。WebTorrent 加入／繼續時合併 |

面板 Start 使用 **serve 程序內** Tracker（與做種同進程）。詳見 [features/bt-tracker-ZH.md](../features/bt-tracker-ZH.md)。

## cron

```bash
ysk-server cron list|create|delete|enable|disable|run|install|status …
```

安裝 crontab 需 EXECUTE。

## email

```bash
ysk-server email domains list|create|get …
ysk-server email mailboxes list|create …
ysk-server email aliases list|create|delete --domain example.com [--type alias|forward|catchall]
ysk-server email flags --domain example.com [--autoreply|--no-autoreply] [--catchall addr] [--antispam]
ysk-server email policy --domain example.com [--antispam|--no-antispam] [--rate N] [--execute]
ysk-server email queue list|flush [--all|--id ID] [--execute]
ysk-server email relay get|apply --host smtp.example.com [--execute]
ysk-server email deliverability --domain example.com
ysk-server email bootstrap --domain D --ip A.B.C.D [--install]
ysk-server email dns --domain D
```

PTR／Port 25 屬外部。見 [../features/email-ZH.md](../features/email-ZH.md)。

## users | packages | rbac | audit | security

```bash
ysk-server users list [--q TEXT] [--role operator] [--totp 0|1]
ysk-server users create --username U --password P [--role operator] [--locale zh-HK]
ysk-server users totp --user NAME
ysk-server users totp-clear --user NAME --confirm-username NAME
ysk-server packages list
ysk-server rbac list|show|audit
ysk-server audit [--q TEXT] [--limit N]
ysk-server security status
ysk-server security sessions list|revoke|revoke-others [--user U]
ysk-server security api-keys list|create|delete …
```

## ssh-key | ssh-2fa

```bash
ysk-server ssh-key list|create|import|public|export|install|delete …
ysk-server ssh-2fa list|enroll|confirm|install|pam|retire …
```

SSH TOTP ≠ 面板 TOTP。

## defense | protection

```bash
ysk-server defense status|firewall|fail2ban|ban|unban|whitelist|stack-apply|presets|timeline …
ysk-server protection …   # defense 別名
```

## cdn

```bash
ysk-server cdn nodes list|upsert|delete|probe|drain …
ysk-server cdn sites list|get|upsert|delete …
ysk-server cdn render|apply|purge|dns-sync|from-project|dashboard|health-loop …
```

## agents | agent

```bash
ysk-server agents runtimes|probe|fleet list|fleet register|fleet commands|register|commands …
ysk-server agent run --control-plane URL --id AGENT_ID [--group g]
```

Fleet：已註冊 ≠ 已連線（需 heartbeat）。入隊需 Bearer；公開路徑僅限 poller。

## logs | host | health | notifications | readiness | doctor | services | db-cluster

```bash
ysk-server logs sources|query|journal|overview …
ysk-server host overview|metrics|network …
ysk-server health [--url http://host:port/health]
ysk-server notifications [list]   # 僅 list——沒有 create/send/channel
ysk-server readiness|doctor [--json]
ysk-server services …
ysk-server db-cluster list|get|create|plan …
```

## migrate

```bash
ysk-server migrate inventory|host|post|status|resume|orphan-homes …
# orphan-homes：列出殘留 /home/ysk-server-<uuid>；刪除需 --path + --confirm + --execute
```

## tools | ask

```bash
ysk-server tools [--json]
ysk-server tools run --tool NAME [--arg k=v] [--dry-run|--execute]
ysk-server ask "自然語言" [--execute]
```

工具受 allowlist 與防護模式約束。

---

## docker

Docker Engine 控制面（面板軟件目錄安裝 `docker.io` + `docker-compose-v2`）。

```bash
ysk-server docker status --json
ysk-server docker ps --json
ysk-server docker images --json
ysk-server docker compose ls --json
YSK_EXECUTE=1 ysk-server docker run --image alpine:3.20 --name demo --execute --json
YSK_EXECUTE=1 ysk-server docker engine start --execute --json
```

見 [../features/docker-ZH.md](../features/docker-ZH.md)。

## validators

L1 驗證者就緒節點（Ethereum、Avalanche、NEAR、Cardano、Bitcoin、Cosmos Hub、Sui、Aptos、Polkadot、Solana）。**Beta。** 非託管 — CLI 不會寫入質押私鑰。Solana 標為 **heavy**（主網 2 TiB 或以上）。

```bash
ysk-server validators list --json
ysk-server validators chains --json
ysk-server validators disk --json
ysk-server validators get --id eth-hoodi-1 --json
ysk-server validators create --chain eth --network hoodi --profile minimal --json
YSK_EXECUTE=1 ysk-server validators create --chain eth --network hoodi --profile minimal --execute --json
YSK_EXECUTE=1 ysk-server validators start --id eth-hoodi-1 --execute --json
YSK_EXECUTE=1 ysk-server validators stop --id eth-hoodi-1 --execute --json
YSK_EXECUTE=1 ysk-server validators clear --id eth-hoodi-1 --confirm --execute --json
ysk-server validators logs --id eth-hoodi-1 --json
ysk-server validators policy --id eth-hoodi-1 --upgrade notify --json
YSK_EXECUTE=1 ysk-server validators upgrade --id eth-hoodi-1 --execute --json
YSK_EXECUTE=1 ysk-server validators mithril --id ada-preview-1 --confirm MITHRIL --execute --json
ysk-server validators create --chain eth --network hoodi --el geth --cl prysm --json
```

沒有 `--execute` 的 create 只寫入實例規格與 compose（`written`）。start／stop／clear 在 `YSK_EXECUTE=1` 加 `--execute` 之前維持 **blocked**。真正套用需要 Docker Compose。

見 [../features/validators-ZH.md](../features/validators-ZH.md)。

## vpn

控制平面主機上的開源 VPN（WireGuard／OpenVPN／Outline 風格 ss-server）。

| 子命令 | 用途 | 需 `--execute`？ |
|--------|------|------------------|
| `status` | 引擎、對等端、客戶端設定檔 | 否 |
| `monitor` | 即時傳輸快照 | 否 |
| `presets` | 埠預設 | 否 |
| `ensure` | 確保伺服器設定 | **是** |
| `stop` | 停止 VPN 伺服器單元 | **是** |
| `peers list\|add\|delete\|config` | 伺服器對等端 | add/delete **是** |
| `clients list\|import\|up\|down\|delete\|autostart` | 本機客戶端 | up/down/delete **是** |
| `firewall open` | 經服務暴露開埠 | **是** |

```bash
ysk-server vpn status --json
ysk-server vpn peers list --engine wireguard --json
ysk-server vpn ensure --engine wireguard --port 51820 --execute --json
ysk-server vpn stop --engine wireguard --execute --json
ysk-server vpn peers add --name laptop --execute --json
ysk-server vpn clients import --name office --file ./wg.conf --json
```

見 [../features/vpn-ZH.md](../features/vpn-ZH.md)。

## vnc

TigerVNC 帳戶、客戶端設定檔、分享連結、noVNC。**瀏覽器畫布仍為僅面板。**

| 子命令 | 用途 | 需 `--execute`？ |
|--------|------|------------------|
| `status`／`settings` | 堆疊與預設 | 設定寫入面板資料 |
| `accounts list\|create\|update\|password\|start\|stop\|delete` | 帳戶生命週期 | create/start/stop/delete **是** |
| `connection`／`firewall`／`novnc` | 連線資訊／UFW／noVNC | firewall/novnc **是** |
| `clients …` | 連出設定檔 | up/down **是** |
| `share create\|info\|revoke` | 分享連結（`/vnc-share/:token`） | 否（面板儲存） |
| `session mint` | 供操作員的 RFB 元資料 | 啟動桌面時可能需 execute |

```bash
ysk-server vnc status --json
ysk-server vnc accounts list --json
ysk-server vnc accounts create --name alice --execute --json
ysk-server vnc share create --id ACCOUNT_ID --json
```

見 [../features/vnc-ZH.md](../features/vnc-ZH.md)。

## apache

Apache 站點與全域設定（面板唯一入口 `/apache`）。

```bash
ysk-server apache sites list|create|update|delete|apply|conf|cleanup-conflicts …
ysk-server apache settings get|set|apply [--execute]
```

見 [../features/apache-ZH.md](../features/apache-ZH.md)。

## network | real-ip

服務網絡暴露（`ysk-svc` 註解）與 CDN Real-IP 信任。

```bash
ysk-server network exposure list|get|put|sync --service ID …
ysk-server real-ip status|set|refresh [--execute]
```

見 [../features/system-host-ZH.md](../features/system-host-ZH.md)。

## updates | software | stack

```bash
ysk-server updates hub [--refresh-runtimes]
ysk-server updates inventory|refresh|apply|apply-batch|summary|self …
ysk-server software list|get|install|uninstall|uninstall-preview|upgrades|versions …
# postgresql：postgres 不在 PATH 但 unit 為 active 時視為已安裝
ysk-server stack plans|bundles|status|install|scan …
ysk-server update [--check] [--apply]   # 產品 npm 自身更新
```

`update` = 產品二進位（npm 上的 `ysk-server`）。`updates hub` = 與面板 `/updates` 同一套 `entries`（面板 + catalog 服務 + runtime + 其餘 apt）。`updates inventory` = 僅 apt 清冊。見 [../features/system-host-ZH.md](../features/system-host-ZH.md)。

## db | redis | db-cluster

```bash
ysk-server db status|console|apply|lifecycle|install --engine mysql|mariadb|postgres|redis …
ysk-server db sql-engine preview|switch --target mysql|mariadb …
ysk-server redis status|settings|keys|get|set|del|install|start …
ysk-server db-cluster list|get|create|plan|apply|probe …
# create --kind postgres-replica 會推斷 --engine postgres；探測以 postgres 用戶執行
```

見 [../features/databases-ZH.md](../features/databases-ZH.md)。

## ftp

```bash
ysk-server ftp status|settings|accounts|options|apply …
ysk-server ftp accounts list|create|update|delete|apply …
ysk-server ftp accounts create --project ID --password P [--username NAME] [--home app|root]
```

見 [../features/files-ftp-ZH.md](../features/files-ftp-ZH.md)。

## runtimes

```bash
ysk-server runtimes list|install|switch|uninstall --kind node|php|python|go|rust|java|kotlin|bun …
ysk-server hosting runtime-install|runtime-switch|runtime-uninstall …
```

引擎含 **java**、**kotlin**、**bun**。見 [../features/runtimes-ZH.md](../features/runtimes-ZH.md)。

---

## 功能文件對照

| 命令域 | 功能頁 |
|--------|--------|
| projects, templates, hosting | [../features/projects-ZH.md](../features/projects-ZH.md) |
| email | [../features/email-ZH.md](../features/email-ZH.md) |
| files, ftp | [../features/files-ftp-ZH.md](../features/files-ftp-ZH.md) |
| backup, cron | [../features/backups-cron-ZH.md](../features/backups-cron-ZH.md) |
| security, users, rbac | [../features/security-auth-ZH.md](../features/security-auth-ZH.md) · [../features/users-rbac-ZH.md](../features/users-rbac-ZH.md) |
| defense | [../features/defense-ZH.md](../features/defense-ZH.md) |
| cdn, agents | [../features/cdn-agents-ZH.md](../features/cdn-agents-ZH.md) |
| logs, host | [../features/logs-metrics-ZH.md](../features/logs-metrics-ZH.md) |
| vpn | [../features/vpn-ZH.md](../features/vpn-ZH.md) |
| docker | [../features/docker-ZH.md](../features/docker-ZH.md) |
| validators | [../features/validators-ZH.md](../features/validators-ZH.md) |
| vnc | [../features/vnc-ZH.md](../features/vnc-ZH.md) |
| apache | [../features/apache-ZH.md](../features/apache-ZH.md) |
| db, redis, runtimes | [../features/databases-ZH.md](../features/databases-ZH.md) · [../features/runtimes-ZH.md](../features/runtimes-ZH.md) |
| network, updates, software | [../features/system-host-ZH.md](../features/system-host-ZH.md) |
| store, readiness | [../architecture/state-store-ZH.md](../architecture/state-store-ZH.md) · [../getting-started/readiness-ZH.md](../getting-started/readiness-ZH.md) |


---

## 高頻旗標（細節）

### setup

| 旗標 | 含義 |
|------|------|
| `--data-dir PATH` | 控制平面目錄（可自動建立） |
| `--admin-username`／`--admin-password` | 首位管理員 |
| `--listen-host`／`--listen-port` | serve 預設綁定 |
| `--locale zh-HK\|zh-CN\|en` | 管理員與預設 UI 語言 |
| `--dry-run` | 只輸出計劃 |
| `--force` | 安全範圍內允許重跑 |
| `--json` | 結構化結果 |

### projects deploy

| 旗標 | 含義 |
|------|------|
| `--id UUID` | 專案 id |
| `--entry FILE` | Node 入口（如 server.js） |
| `--port N` | 監聽埠 |
| `--fpm` | 優先 PHP-FPM |
| `--execute` | 真實部署（需 EXECUTE；systemd 常需 root） |

無 `--execute`：只計劃／寫 dataDir 管理 unit。

### backup

| 子命令 | 說明 |
|--------|------|
| `list`／`status` | 唯讀庫存 |
| `all` | 完整備份回合 |
| `schedule --install` | 安裝排程（EXECUTE） |
| `control-plane` | 備份控制平面狀態 |
| `restic …` | 已設定時的 restic 輔助 |
| `settings get\|set\|test` | 遠端目的地；test 可用未儲存值 + 出站身分；真正探測需 EXECUTE |

### email deliverability

| 旗標 | 含義 |
|------|------|
| `--domain` 或域名 id | 目標郵件域名 |
| `--json` | 項目 + 誠實 notes |

絕不宣稱全球 inbox 成功。

### security

| 子命令 | 含義 |
|--------|------|
| `status` | 2FA 旗標、管理員計數 |
| `sessions list\|revoke\|revoke-others` | 以 `--user` 管理工作階段 |
| `api-keys list\|create\|delete` | 操作員 API 金鑰；建立時 token 只顯示一次 |

### defense

| 子命令 | 含義 |
|--------|------|
| `status` | 防護堆疊快照 |
| `firewall`／`fail2ban` | 子系統狀態／計劃 |
| `ban`／`unban`／`whitelist` | IP 動作（上線需 EXECUTE） |
| `stack-apply`／`presets`／`timeline` | 防護中心操作 |

### store

| 子命令 | 含義 |
|--------|------|
| `status` | 後端種類 + 計數 |
| `export`／`import` | document 快照 JSON |
| `migrate --to json\|sqlite\|postgres` | 切換後端 |

### readiness／doctor

唯讀生產門檻。未達標可非 0 結束（JSON 仍有用）。

```bash
ysk-server readiness --json
ysk-server doctor --json
```
