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

## 已接受殘項

| 編號 | 原因／營運控制 |
|------|----------------|
| R-1 | `root` + `YSK_EXECUTE=1` 設計上等同一部主機。唔用時關 EXECUTE。 |
| R-2 | 分享**檔案** GET 仍可用 `?password=`（`<a href>`／torrent）。優先用標頭。存取日誌可能記下密碼。 |
| R-3 | 密碼式 SFTP 用 `sshpass`（root 可見行程）。優先用 SSH 身分庫。 |
| R-4 | 第一次 SSH 備份仍係 `accept-new`（TOFU）。正式環境應釘 `known_hosts`。 |
| R-5 | 安裝 checksum 釘選（I-07）仍按營運文件。 |

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
  src/net/ssrf.test.ts
```
