# Host Browse

> 語言：中文（香港書面語）| [English](./host-browse.md)

## 用途

互動式 **Chromium 工作階段 UI**，自控制平面瀏覽（僅面板介面）。

**非目標：** 取代 VNC／桌面；遠端 SSH 產品。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | Host Browse UI |
| 導航鍵 | `hostBrowse` |
| 主要操作 | 工作階段列表 · 開啟瀏覽器面 |
| 能力 | Host browse |
| RBAC | 操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 互動瀏覽器 | — | ⚠️ 僅面板 | 刻意 |
| （可選未來）工作階段列表 | — | — | 封板不強制 |

## CLI 速查

無生產 CLI。遠端桌面／shell 請用 [VNC](./vnc-ZH.md) 或 SSH。

## 誠實邊界

- 在對等矩陣中標為 **僅面板**。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 整個 Host Browse Chromium UI | 互動瀏覽器面 |

## 相關

- [面板 ↔ CLI 矩陣](../cli/panel-parity-matrix-ZH.md) · [VNC](./vnc-ZH.md)  
