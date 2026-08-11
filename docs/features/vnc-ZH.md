# VNC（伺服器帳號 + 客戶端）

> 語言：繁體中文（香港書面語）| [English](./vnc.md)

## 用途

喺控制面主機管理 **遠端桌面**：

- **伺服器帳號** — 每個帳號係獨立 **Linux 用戶**（`yskvnc_*`）+ 獨立 TigerVNC display
- **瀏覽器內 VNC**（主路徑）— **在瀏覽器開啟**：面板經 WebSocket 代理 RFB + 內嵌 noVNC（鍵鼠、剪貼簿、畫質、截圖、短錄影）
- **客戶端設定** — 本機 **連出**去遠端 `host:port`，同一瀏覽器路徑
- **舊路徑** — 主機端 `vncviewer`、本機 noVNC URL（進階）

## 堆疊

| 元件 | softwareId | 說明 |
|------|------------|------|
| TigerVNC | `tigervnc` | 多用戶 `vncserver` session |
| noVNC（npm `@novnc/novnc`） | — | 嵌喺面板；用戶瀏覽器唔使開 `127.0.0.1` |
| 面板 WS RFB 代理 | — | `POST /api/v1/vnc/sessions` + `WS /api/v1/vnc/ws?ticket=…` |
| websockify／套件 noVNC | `novnc` | 可選舊版「啟動 noVNC」 |
| XFCE（可選） | `vnc-desktop-xfce` | 完整桌面 profile |
| Viewer（可選） | `tigervnc-viewer` | 主機端直連 |

每帳桌面 profile：**最小** · **XFCE** · **無**。

## 路由

| 項目 | 值 |
|------|-----|
| UI | `/vnc` |
| 公開分享 | `/vnc-share/:token`（唔使登入面板；預設 **只讀**） |
| API | `/api/v1/vnc/*` |
| 能力 | `network.vnc`（開埠另需 `firewall.edit`） |
| 安裝 | 軟件 banner 需 **root + `YSK_EXECUTE`** |

## 瀏覽器 Viewer（主路徑）

1. **帳號** 或 **客戶端** → **在瀏覽器開啟**
2. 面板發短命 ticket，經控制面把 RFB 接到用戶瀏覽器（開到面板就得，唔使為 RFB 開 SSH tunnel）
3. 工具列：重連、適合視窗/1:1、畫質、全螢幕、Ctrl+Alt+Del、剪貼簿、分享、截圖、錄影（WebM ≤60 秒）
4. 最多 **4** 個同時 session（分頁）
5. **分享連結**（只讀，約 1 小時）：複製 → 對方開 `/vnc-share/:token`

**連出客戶端：** 控制面主機要可以 TCP 連到遠端 `host:port`。

## 伺服器流程

1. **安裝** → TigerVNC  
2. **設定** → 預設桌面／解析度／RFB 監聽（預設 **localhost**）  
3. **帳號** → 建立  
4. 密碼 → **啟動**（或由「在瀏覽器開啟」代啟動）  
5. **在瀏覽器開啟**（建議）  
6. **連線**物料（進階）：舊 noVNC 本機 URL、直連 RFB + UFW  

## 客戶端流程

1. **客戶端** → 新增 `host:port`（可選記住密碼，有警告）  
2. **在瀏覽器開啟**（建議）  
3. 可選：**主機查看器**（喺呢部伺服器跑 `vncviewer`）  

## 安全

- 本機帳號 RFB 預設 **localhost**；瀏覽器路徑唔會把 RFB 直接暴露公網 — 只經面板認證（或分享 token）嘅 WebSocket  
- 分享連結預設 **只讀** 且會過期  
- 密碼唔寫 audit；可選存客戶端密碼喺 dataDir（root 可讀）  
- 無 `YSK_EXECUTE`／非 root：寫 meta；開本機桌面誠實 **blocked**  

## 相關

- [VPN](./vpn-ZH.md) — 建議先隧道再 VNC  
- 防火牆／防護中心 — 埠策略  
