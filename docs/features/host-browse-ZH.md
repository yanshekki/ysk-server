# 主機瀏覽（Host Browse）

> 語言：中文 | [English](./host-browse.md)

## 用途

**主機瀏覽** 讓營運者經 **控制面主機** 開啟 HTTP(S) 網址：

- 外網（公網站點）與內網（LAN／RFC1918 管理頁）
- 出口 IP、DNS、TLS 由 **主機** 處理，不是操作者桌面瀏覽器
- 目標站唔會見到操作者瀏覽器 UA、Client Hints、panel Cookie 或操作者客戶端 IP

## 路由

| 項目 | 值 |
|------|-----|
| UI | `/browse` |
| API | `/api/v1/host-browse/*` |
| 能力 | `network.browse`（特權；管理員出廠包含） |
| `YSK_EXECUTE` | **不需要**（panel 進程出站 HTTP） |

## 分頁

| 分頁 | 內容 |
|------|------|
| 主機瀏覽 | 瀏覽器 chrome + 外網/內網模式 + 沙箱內容 |
| 說明 | 頁面指南（安全模型與限制） |

## 私隱模型

- 固定 User-Agent：`YSK-HostBrowse/1.0 …`
- 只允許出站 header 白名單（唔轉發 `Authorization`、`Sec-CH-*`、`X-Forwarded-For`、panel `Origin` 等）
- Cookie jar **只在伺服器**、按工作階段
- 內容 iframe 用短命 `contentToken`（避免長期 API Bearer 入 log）

## SSRF

| 模式 | 策略 |
|------|------|
| 外網 | 拒 loopback、RFC1918、link-local、ULA、cloud metadata |
| 內網 | 允許私網；**永遠**拒 cloud metadata；loopback 預設關（`YSK_HOST_BROWSE_LOOPBACK=1` 可開） |

DNS rebinding：解析 A/AAAA 並檢查每個地址；redirect 再檢。

## 限制（v1）

- 唔係完整 Chromium 替代 — 複雜 SPA 可能顯示不全
- 唔代理目標 WebSocket
- 回應體約 8 MiB 上限；約 60 次導航／用戶／分鐘

## 相關

[系統主機](./system-host-ZH.md) · [product-page-map](../product-page-map-ZH.md)
