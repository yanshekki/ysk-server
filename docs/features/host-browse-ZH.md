# 主機瀏覽（Host Browse）

> 語言：繁體中文（香港書面語）| [English](./host-browse.md)

## 用途

**主機瀏覽** 讓營運者經 **控制面主機** 開啟 HTTP(S) 網址：

- 外網與內網（LAN／RFC1918）
- 出口 IP、DNS、TLS 由 **主機** 處理
- 目標站不會看見操作者桌面瀏覽器身分

## 雙引擎

| 引擎 | 原理 | 適合 |
|------|------|------|
| **代理** | 主機 HTTP 擷取 + HTML/CSS 改寫 + sandbox iframe | 文件、靜態站、多數管理頁、表單 POST |
| **真實瀏覽器** | 主機 **Chromium**（Playwright）+ 畫面串流 + 滑鼠鍵盤 | 重型 SPA、需完整 JavaScript 渲染 |

### 面板設定

| 設定 | 作用 |
|------|------|
| 預設引擎 | 自動／代理／真實瀏覽器 |
| Chrome 路徑 | 覆寫自動偵測 |
| 允許 loopback | 內網可開啟 127.0.0.1 |
| --no-sandbox | 供 container 使用 Chromium |
| 安全等級 | 嚴格／標準／寬鬆 |
| 封鎖主機清單 | 額外主機名稱封鎖 |
| 危險下載 | 允許 exe／sh 等高風險類型 |
| **音訊橋接** | HTML 媒體 PCM 經即時串流（見影音） |

設定存於面板資料庫（`settings.hostBrowse`）。**面板值優先於程序環境變數。**

### 一鍵安裝

於 **軟件** 分頁安裝目錄 id `chromium`。需要 root 與 `YSK_EXECUTE=1`。

### 環境變數（面板未設定時之後備）

- `YSK_HOST_BROWSE_ENGINE`／`CHROME`／`NO_SANDBOX`／`LOOPBACK`
- `YSK_HOST_BROWSE_AUDIO=1` — 啟用音訊橋接

## 路由

| 項目 | 值 |
|------|-----|
| UI | `/browse` |
| API | `/api/v1/host-browse/*` |
| Live WS | `/api/v1/host-browse/ws?ticket=` |
| 能力 | `network.browse` |
| `YSK_EXECUTE` | 瀏覽本身不需要；安裝 Chromium／臨時 Linux 用戶需要 |

### 工作階段 API 摘要

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | `/sessions` | 建立工作階段 |
| POST | `/sessions/:id/navigate` | 導航 |
| POST | `/sessions/:id/live` | 即時串流 ticket |
| GET/POST/DELETE | `/sessions/:id/tabs…` | 真實瀏覽器多分頁（最多 6） |
| GET | `/sessions/:id/downloads` | 下載列表 |
| GET | `/library` | 主頁／書籤／記錄／lastSnapshot |
| DELETE | `/last-snapshot` | 略過恢復提示 |
| POST | `/sessions/:id/heartbeat` | 維持真實瀏覽器工作階段 |

### 即時 WebSocket

**主機 → 面板：** `frame`（JPEG）、`audio`（s16le PCM）、`audio_status`、`tabs`、`meta`、`err`

**面板 → 主機：** `mouse`、`key`、`resize`、`stream`、`tab_open`／`tab_switch`／`tab_close`、`ping`

## 私隱與 SSRF

固定 User-Agent、伺服器端 Cookie、按模式 SSRF、metadata 一律拒絕。可選臨時 Linux 用戶 `yskb_*` + CDP 連線 Chrome（root + `YSK_EXECUTE`）。

## 瀏覽器殼功能

- 捲動、緊湊工具列、畫質預設（流暢／均衡／高清）
- 主頁／書籤／記錄；返回可恢復上次分頁快照
- **伺服器端多分頁**（最多 6）
- 下載抽屜與副檔名安全
- 離開頁面／heartbeat 逾時結束 Chrome 與臨時用戶
- 安全等級與自訂封鎖主機
- **影音**
  - 影像：JPEG 畫面串流
  - 音訊：預設未橋接（Chrome 靜音）
  - 可選音訊橋接：HTML `video`／`audio` 的 `captureStream` → PCM → 面板 Web Audio（需點擊解鎖）。非完整系統音訊／DRM。

## 限制

- 代理模式並非完整 Chrome 替身
- 真實引擎需要主機安裝 Chrome
- 音訊橋接僅涵蓋可擷取音軌的文件內媒體元素
- 不保證可繞過網站 bot 防護

## 驗證

```bash
pnpm --filter @ysk/core exec vitest run src/host-browse
bash scripts/e2e-host-browse.sh
```
