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

- UI：**代理 | 真實瀏覽器**
- 環境變數：`YSK_HOST_BROWSE_ENGINE=auto|proxy|browser`
- Chrome：`YSK_HOST_BROWSE_CHROME` 或系統 chrome/chromium
- 內網 loopback：`YSK_HOST_BROWSE_LOOPBACK=1`

無 Chrome 時要求 browser 會回 `YSK_HOST_BROWSE_NEED_CHROME`（誠實失敗／UI 可降級代理）。

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
