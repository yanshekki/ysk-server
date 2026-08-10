# VNC（伺服器帳號 + 客戶端）

> 語言：繁體中文（香港書面語）| [English](./vnc.md)

## 用途

喺控制面主機管理 **遠端桌面**：

- **伺服器帳號** — 每個帳號係獨立 **Linux 用戶**（`yskvnc_*`）+ 獨立 TigerVNC display
- **連入路徑** — **經 server**（本機 noVNC／websockify）或 **用戶自己網絡直連 RFB**
- **客戶端** — 本機 **連出**去遠端 VNC（同樣雙路徑）

## 堆疊

| 元件 | softwareId | 說明 |
|------|------------|------|
| TigerVNC | `tigervnc` | 多用戶 `vncserver` session |
| noVNC + websockify | `novnc` | 瀏覽器連入；RFB 預設只聽 127.0.0.1 |
| XFCE（可選） | `vnc-desktop-xfce` | 完整桌面 profile |
| Viewer（可選） | `tigervnc-viewer` | 直連 client 路徑 |

每帳桌面 profile：**最小** · **XFCE** · **無**。

## 路由

| 項目 | 值 |
|------|-----|
| UI | `/vnc` |
| API | `/api/v1/vnc/*` |
| 能力 | `network.vnc`（開埠另需 `firewall.edit`） |
| 安裝 | 軟件 banner 需 **root + `YSK_EXECUTE`** |

## 伺服器流程

1. **安裝**分頁 → TigerVNC（再裝 noVNC）
2. **設定** → 預設桌面／解析度／RFB 監聽（預設 **localhost**）
3. **帳號** → 建立（Linux 用戶 + display `:N`／埠 `5900+N`）
4. 設定 VNC 密碼 → **啟動** session
5. **連線**物料：
   - **經 server**：啟動 noVNC → 開本機 URL（或 SSH 隧道 HTTP 埠）
   - **直連**：bind=全部介面 + UFW 放行 TCP `5900+N` → RealVNC／TigerVNC

## 客戶端流程

1. **客戶端**分頁 → 新增遠端 `host:port`
2. 揀路徑：**經 server**（websockify 代理 + 本機 noVNC）或 **直連**（`vncviewer`）
3. 連線／斷線

## 安全

- RFB 預設 **只聽 localhost** — 對外建議 noVNC 或先 VPN
- 密碼唔寫入 audit
- 無 `YSK_EXECUTE`／非 root：只寫控制面 meta，系統操作誠實 **blocked**
- 刪帳可選是否 `userdel` Linux 用戶

## 相關

- [VPN](./vpn-ZH.md) — 建議先隧道再 VNC
- 防火牆／防護中心 — 埠策略
