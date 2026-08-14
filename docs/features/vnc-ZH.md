# VNC

> 語言：中文（香港書面語）| [English](./vnc.md)

## 用途

在控制平面主機提供 **桌面遠端存取**：TigerVNC 帳戶、連出客戶端設定檔、分享連結與 noVNC 輔助。

**非目標：** 取代完整遠端桌面產品；多租戶桌面 SaaS。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/vnc` · 分享落地 `/vnc-share/:token` |
| 導航鍵 | `vnc` |
| 主要區域 | 狀態 · 帳戶 · 客戶端 · 檢視器 · 分享 |
| 能力 | VNC 託管相關能力 |
| RBAC | 獲授權管理 VNC 的操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 堆疊／狀態 | `ysk-server vnc status --json` | read | |
| 設定讀寫 | `ysk-server vnc settings get\|set …` | write-panel | |
| 列出帳戶 | `ysk-server vnc accounts list --json` | read | |
| 建立帳戶 | `ysk-server vnc accounts create --name N --execute --json` | write-host | Linux 用戶 + VNC |
| 更新／密碼 | `ysk-server vnc accounts update\|password …` | write-host | 密碼需 execute |
| 啟動／停止／刪除 | `ysk-server vnc accounts start\|stop\|delete --id … --execute` | write-host | |
| 連線資訊 | `ysk-server vnc connection --id … --json` | read | |
| 開啟防火牆 | `ysk-server vnc firewall --id … --execute` | write-host | |
| noVNC 啟動／停止 | `ysk-server vnc novnc start\|stop --id … --execute` | write-host | |
| 客戶端設定檔 CRUD | `ysk-server vnc clients …` | write-panel／write-host | up/down 屬主機 |
| 分享建立／查詢／撤銷 | `ysk-server vnc share …` | write-panel | |
| Session mint（元資料） | `ysk-server vnc session mint --id …` | read/write-host | 可能啟動桌面 |
| **面板內 RFB 畫布** | — | ⚠️ 僅面板 | 互動檢視器 |

## CLI 速查

```bash
ysk-server vnc status --json
ysk-server vnc accounts list --json
export YSK_EXECUTE=1
ysk-server vnc accounts create --name alice --password '…' --execute --json
ysk-server vnc share create --id ACCOUNT_ID --json
ysk-server vnc session mint --id ACCOUNT_ID --json
```

完整 argv：[../cli/reference-ZH.md](../cli/reference-ZH.md#vnc)。

## 誠實邊界

- 帳戶建立／啟動／停止需 EXECUTE + root（`useradd`／`vncserver`）。  
- 分享連結為短效 token；公開落地頁為 `/vnc-share/:token`（無需登入面板）。訪客兌換為 `POST /api/v1/vnc/share/:token/session`。關閉檢視器只結束本次 session，**不會**把訪客送到 `/login`。  
- `session mint` 回傳 RFB 元資料，**不會**在終端開啟桌面畫布。  
- 側欄與路由閘都要 `network.vnc`（不是 `firewall.edit`）。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 瀏覽器 VNC 檢視器（畫布、剪貼簿、錄影） | 互動 WebSocket RFB UI |
| 公開分享頁操作 | 僅瀏覽器兌換流程 |

## 相關

- [面板 ↔ CLI 矩陣](../cli/panel-parity-matrix-ZH.md)  
- [CLI 參考 — vnc](../cli/reference-ZH.md#vnc)  
- [VPN](./vpn-ZH.md)  
- [運維誠實](../architecture/ops-honesty-ZH.md)  
