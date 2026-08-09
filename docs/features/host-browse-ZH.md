# 主機瀏覽（Host Browse）

> 語言：中文 | [English](./host-browse.md)

## 用途

**主機瀏覽** 讓營運者經 **控制面主機** 開啟 HTTP(S)：

- 外網與內網（LAN／RFC1918）
- 出口 IP、DNS、TLS 由 **主機** 處理
- 目標站唔會見到操作者桌面瀏覽器身分

## 雙引擎

| 引擎 | 原理 | 適合 |
|------|------|------|
| **代理** | 主機 HTTP 擷取 + HTML/CSS 改寫 + sandbox iframe | 文件、靜態站、多數管理頁、表單 POST |
| **真實瀏覽器** | 主機 **Chromium**（Playwright）+ 畫面串流 + 滑鼠鍵盤 | 重 SPA、需完整 JS 渲染 |

### 面板設定（建議）

**主機瀏覽 → 設定**／**軟件** 分頁：

| 設定 | 作用 |
|------|------|
| 預設引擎 | 自動／代理／真實瀏覽器 |
| Chrome 路徑 | 覆寫自動偵測 |
| 允許 loopback | 內網可開 127.0.0.1 |
| --no-sandbox | container 用 Chromium |

存於面板 DB（`settings.hostBrowse`）。**面板值優先於行程環境變數。**

### 一鍵安裝

**軟件** 分頁 → 安裝目錄 id `chromium`（apt 發行版 Chromium）。已裝 Google Chrome 亦會偵測。需要 root + `YSK_EXECUTE=1`。

### 環境變數（面板未設時後備）

- `YSK_HOST_BROWSE_ENGINE` / `CHROME` / `NO_SANDBOX` / `LOOPBACK`

無 Chrome 時要求 browser 會回 `YSK_HOST_BROWSE_NEED_CHROME`。

## 路由

| 項目 | 值 |
|------|-----|
| UI | `/browse` |
| API | `/api/v1/host-browse/*` |
| Live WS | `/api/v1/host-browse/ws?ticket=` |
| 能力 | `network.browse` |
| `YSK_EXECUTE` | **不需要** |

## 私隱與 SSRF

同英文版：固定 UA、server cookie、分模式 SSRF、metadata 永拒。

## 限制

- 代理唔係完整 Chrome 替身
- 真實引擎要主機有 Chrome，消耗 CPU/RAM
- 唔保證繞過網站 bot 防護
