# 安全審計 — ysk-server 1.0.8

> 語言：中文 | [English](./audit-1.0.8.md)

對已發布 1.0.8 控制平面的現場審計。發現項標 **已修**、**已接受** 或 **未完**。已確認漏洞以 fail-closed 修好，並有防禦性測試。

威脅模型：面板埠可從不可信網絡到達。攻擊者：未登入、低權限工作階段、無 EXECUTE 的管理員、root + EXECUTE 的管理員。

## 方法

攻擊面盤點 · STRIDE · OWASP ASVS L2／Top 10 · RBAC 對 `route-capabilities` · 密碼學／秘密 · 注入／路徑／SSRF · 安裝供應鏈 · 重核 S0／S1／S2／P7／I-*。

測試只行使**防禦**（401／403／422／封鎖主機）。不附攻擊 payload。

## 公開面（A0）

| 路徑 | 認證 | 說明 |
|------|------|------|
| `GET /health`、`GET /api/v1/health` | 無（存活） | execute／root 欄位**只在已登入**回傳 |
| `GET /api/v1/status` | 無（子集） | dataDir／tools／execute 只在已登入 |
| `GET /api/v1/readiness` | 無（布林） | 完整項目／專案家目錄只在已登入 |
| Autoconfig／Autodiscover XML | 無 | 要網域參數；不列郵箱 |
| `GET /api/v1/public/files/:token` | 分享 token ± 密碼 | 限流；優先標頭密碼 |
| `/webdav/*` | Basic ysk:token | 限流 |
| `WS /api/v1/public/bt-tracker` | 無 | 只代理本機 tracker |
| 登入／登出 | 公開 | 登入限流 |

WebSocket（要 ticket）：終端、VNC、Host Browse。

## 發現

| 編號 | 級 | 範圍 | 狀態 |
|------|----|------|------|
| A08-1 | 中 | 未登入 `/health` 洩 `executeEnabled`／`isRoot` | **已修** |
| A08-2 | 高 | 未登入 `/api/v1/readiness` 跑完整評估並洩專案 `homeDir` | **已修** — 公開探測只回布林 |
| A08-3 | 高 | `requireUserTotp` 只係提示，未登記仍可用 API | **已修** — `enforceMustEnrollTotp` + 登入轉 `/security` |
| A08-4 | 中 | 分享密碼出現在 JSON（`meta`／`bt-stats`）查詢字串 | **已修** — query 只限檔案／torrent GET；面板 fetch 用標頭 |
| A08-5 | 高 | 備份 S3 endpoint／SFTP 主機可指向 IMDS／loopback | **已修** |
| A08-6 | 中 | 備份 SSH 用 `StrictHostKeyChecking=no` | **已修** — `accept-new` |
| A08-7 | 低 | API／SPA 缺 Content-Security-Policy | **已修** |
| A08-8 | 危急 | `bash -c` 只要有 `postqueue`／`grep` 就當成段只讀（可夾 `reboot`） | **已修** — 拒絕電源／防火牆動詞；postqueue 只准 `-p`／if 包裝 |
| A08-9 | 中 | 任何工作階段可 `GET /api/v1/terminal/targets`（Linux 用戶＋家目錄） | **已修** — 要 `settings.system` 或 `services.control` |
| A08-10 | 高 | IPv6-mapped IMDS／AWS `fd00:ec2::`／阿里雲 `100.100.100.200` 繞過 SSRF | **已修** |
| A08-11 | 高 | Unzip zip-slip／父層 symlink 逃出 FileManager | **已修** |
| A08-12 | 高 | 匯入 VPN 客戶端 `PostUp`／OpenVPN `up` 會以 root 執行 | **已修** — 匯入同啟動前剝走 hook |
| A08-13 | 高 | FTP `homePath` 可設 `/etc` 再 apply mkdir／chroot | **已修** — 只准 dataDir 或專案家目錄 |
| A08-14 | 高 | 模擬登入可以扮成另一個 **admin** | **已修** — 拒絕 admin 目標 + TOTP step-up |
| A08-15 | 高 | Host Browse `chromePath` 會當面板行程 `executablePath`，無允許清單 | **已修** — 只准套件路徑＋瀏覽器檔名；無效 env／庫存會丟棄 |
| A08-16 | 高 | VNC 客戶端 `host`／`connectHost` 可 TCP 代理去 IMDS／link-local | **已修** — 准 loopback；拒 IMDS／`metadata`／`fd00:ec2::`／`100.100.100.200` |
| A08-17 | 中 | 公開 VNC 分享兌換無限流（可刷 ticket／估 token） | **已修** — 每 IP 15 分鐘 30 次 + 10 次失敗鎖 |
| A08-18 | 高 | OpenVPN 客戶端啟動只複製庫存 conf，未再剝 hook | **已修** — 複製前再剝；多攔 `down-pre`、`management` 等 |
| A08-19 | 高 | VPN `listenPort` 未強制整數就插入 bash | **已修** — `parseVpnListenPort`／`coerceVpnListenPort` |
| A08-20 | 中 | 任何已登入工作階段可 `GET` 資料庫／Redis 控制台（含 `requirepass`） | **已修** — 要 `mysql.console.write` **或** `services.control` **或** `settings.system` |
| A08-21 | 低 | WebDAV PROPFIND 無上限；PUT 無體積上限 | **已修** — 500 項／50 MiB |
| A08-22 | 高 | LLM 只要 URL 字串有 `localhost` 就 `allowPrivate`（IMDS + `?localhost`） | **已修** — 只睇 hostname；儲存時 `assertSafeOutboundUrl` |
| A08-23 | 高 | 公開 Autoconfig／Autodiscover 未淨化就把 `domain`／`email` 插入 XML | **已修** — 網域／電郵允許清單 + XML 轉義；非法參數 400 |
| A08-24 | 高 | Nginx `server_name` 未淨化就寫入 conf | **已修** — 列出同渲染時允許清單 |
| A08-25 | 高 | `GET /settings/llm` 任何工作階段都回存好嘅 `apiKey` | **已修** — 要 `settings.system` + 遮成 `***` |
| A08-26 | 中 | SSH 身分列表／公鑰／詳情同 Fleet 列表係任何 session 嘅 GET | **已修** — 身分：`settings.system`／`security.policy`／`backups.run`；Fleet：`settings.system`／`services.control` |
| A08-27 | 低 | Fleet enroll token 用 `===`；開機失敗把 `err.message` 直接寫入 `innerHTML` | **已修** — `timingSafeEqual`；開機錯誤轉義 |
| A08-28 | 中 | 盤點 GET（電郵、專案、SSL、備份、DNS、CDN、日誌、用戶…）任何 session 都可睇 | **已修** — 中央 `GET_ROUTE_CAP_RULES` 任一 cap（viewer 讀權仍過；只有 `users.self` 唔過） |
| A08-29 | 高 | Apache `ServerName`／PHP vhost 未淨化就寫入 conf | **已修** — 同 nginx 主機名允許清單 |

## 已接受殘項

| 編號 | 原因／營運控制 |
|------|----------------|
| R-1 | `root` + `YSK_EXECUTE=1` 設計上等同一部主機。唔用時關 EXECUTE。 |
| R-2 | 分享**檔案** GET 仍可用 `?password=`（`<a href>`／torrent）。優先用標頭。存取日誌可能記下密碼。 |
| R-3 | 密碼式 SFTP 用 `sshpass`（root 可見行程）。優先用 SSH 身分庫。 |
| R-4 | 第一次 SSH 備份仍係 `accept-new`（TOFU）。正式環境應釘 `known_hosts`。 |
| R-5 | 安裝 checksum 釘選（I-07）仍按營運文件。 |
| R-6 | Host Browse `--no-sandbox` 仍係容器營運選項。配合 A08-15，只會啟動允許清單內嘅 Chrome。 |
| R-7 | `YSK_HOST_BROWSE_CHROME`／`/usr` `/opt/google` `/snap` 以外嘅自訂 Chrome 會被忽略（回落探測）。 |
| R-8 | VNC `server_proxy` 仍可連 RFC1918（設計如此）。IMDS 已攔。 |
| R-9 | 檔案編輯器 `highlightToHtml` 有轉義（已審）。CSP 仍然生效。 |
| R-10 | `pnpm audit`：Vitest UI／Vite／brace-expansion／nanoid 屬**開發依賴**。間接依賴 `ip@2.0.1`（webtorrent tracker）暫無修補版；我哋 SSRF 用 `net/ssrf.ts`。面板 SPA 用 `BrowserRouter`，唔係 React Router RSC。`react-router-dom` 已升到 `^7.18.2`。 |

## 本輪已審、無需再改碼

Host Browse CDP 只綁 `127.0.0.1`。Live WS ticket 一次過＋TTL。VNC／終端 ticket 已 consume-once＋過期。CDN 健康用 `assertSafeOutboundUrl`。遷移臨時金鑰 `0600`／目錄 `0700`。Outline 無 script hook。檔案 highlight 有轉義；其餘 `innerHTML` 係 VNC 清畫面或已轉義開機錯誤。專案 Linux 用戶由 UUID 衍生（`ysk-…`），唔係專案名。備份 GET 已遮秘密。郵箱列表已剝 hash。資源列表已遮密碼。SQL 開庫校識別字＋轉義密碼。安裝 I-07 仍按文件（R-5）。公開 BT tracker WS 只代理本機。npm 產品包係 `dist`＋`public`＋README。其餘未列 GET（dashboard、搜尋、auth 自助）仍只要求已登入。

## 先前階段重核

S0 fail-closed `isMutatingArgv`、S1 session hash／XFF／cron／SQL、S2 status 子集／CDN SSRF／分享與 WebDAV 限流 — 代碼仍在。本輪只以上表重開。

## 驗證

```bash
pnpm --filter ysk-server exec vitest run \
  src/routes/public.test.ts \
  src/http/auth-guards.enroll.test.ts \
  src/controllers/system-controller.test.ts
pnpm --filter ysk-server-core exec vitest run \
  src/hosting/backup-remote.test.ts \
  src/net/ssrf.test.ts \
  src/host-browse/chrome-path.test.ts \
  src/hosting/vnc/client-profiles.test.ts \
  src/hosting/vpn/client-conf-protect.test.ts \
  src/hosting/vpn/ports.test.ts \
  src/security/mfa/rate-limit.test.ts \
  src/llm/http-transport.test.ts \
  src/email/autodiscover.test.ts \
  src/hosting/nginx-ssl.test.ts \
  src/host-browse/live-ticket.test.ts
```
