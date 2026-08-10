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

### 面板設定（建議）

於 **主機瀏覽 → 設定** 或 **軟件** 分頁：

| 設定 | 作用 |
|------|------|
| 預設引擎 | 自動／代理／真實瀏覽器 |
| Chrome 路徑 | 覆寫自動偵測 |
| 允許 loopback | 內網可開啟 127.0.0.1 |
| --no-sandbox | 供 container 使用 Chromium |

設定存於面板資料庫（`settings.hostBrowse`）。**面板值優先於程序環境變數。**

### 一鍵安裝

於 **軟件** 分頁安裝目錄 id `chromium`（經 apt 安裝發行版 Chromium）。若已安裝 Google Chrome 亦會偵測。需要 root 與 `YSK_EXECUTE=1`。

### 環境變數（面板未設定時之後備）

- `YSK_HOST_BROWSE_ENGINE`／`CHROME`／`NO_SANDBOX`／`LOOPBACK`

若要求使用 browser 引擎但主機沒有 Chrome，會回傳 `YSK_HOST_BROWSE_NEED_CHROME`。

## 路由

| 項目 | 值 |
|------|-----|
| UI | `/browse` |
| API | `/api/v1/host-browse/*` |
| Live WS | `/api/v1/host-browse/ws?ticket=` |
| 能力 | `network.browse` |
| `YSK_EXECUTE` | **不需要**（一鍵安裝軟件除外） |

## 私隱與 SSRF

與英文版相同：固定 User-Agent、伺服器端 Cookie、按模式 SSRF、metadata 一律拒絕。

## 限制

- 代理模式並非完整 Chrome 替身
- 真實引擎需要主機安裝 Chrome，並會消耗 CPU／記憶體
- 不保證可繞過網站 bot 防護

## 真實瀏覽器：畫質與尺寸

- **畫質預設**：流暢／均衡（預設）／高清，即時生效，無需重開工作階段。
- **視區**：預設跟隨面板視窗大小，視窗縮放會同步 Chromium viewport。
- **縮放**：適合窗口／百分比，只影響顯示；滑鼠座標已對應 letterbox。
- **錯誤**：逾時、DNS、TLS、人機驗證、串流失敗等均有代碼與重試動作。

## 瀏覽器殼功能

- **捲動**：真實瀏覽器視區支援滾輪（已修復）
- **緊湊工具列**：畫質／縮放改為下拉，節省垂直空間
- **主頁／書籤／記錄**：工具列 ⌂ ☆ 🕐
- **多個分頁**：真實引擎可開最多 6 個分頁
- **全螢幕**：⛶
- **離開頁面**：heartbeat 逾時會結束 Chrome；若已建立臨時 Linux 用戶會嘗試刪除
- **危險站**：封鎖清單與警告（可設定）
- **影音**：影像經串流；音訊尚未橋接（二期）

