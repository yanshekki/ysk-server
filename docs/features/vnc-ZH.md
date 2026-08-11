# VNC（伺服器帳號 + 客戶端）

> 語言：繁體中文（香港書面語）| [English](./vnc.md)

## 用途

在控制面主機管理 **遠端桌面**：

- **伺服器帳號** — 每個帳號為獨立 **Linux 用戶**（`yskvnc_*`）及獨立 TigerVNC display
- **瀏覽器內 VNC**（主路徑）— **在瀏覽器開啟**：面板經 WebSocket 代理 RFB，並內嵌 noVNC（鍵鼠、剪貼簿、畫質、截圖、短錄影）
- **客戶端設定** — 本機 **連出** 至遠端 `host:port`，使用同一瀏覽器路徑
- **舊路徑** — 主機端 `vncviewer`、本機 noVNC URL（進階）

## 堆疊

| 元件 | softwareId | 說明 |
|------|------------|------|
| TigerVNC | `tigervnc` | 多用戶 `vncserver` 工作階段 |
| noVNC（npm `@novnc/novnc`） | — | 嵌於面板；用戶瀏覽器無需開啟 `127.0.0.1` |
| 面板 WS RFB 代理 | — | `POST /api/v1/vnc/sessions` + `WS /api/v1/vnc/ws?ticket=…` |
| websockify／套件 noVNC | `novnc` | 可選舊版「啟動 noVNC」 |
| XFCE（可選） | `vnc-desktop-xfce` | 完整桌面 profile |
| Viewer（可選） | `tigervnc-viewer` | 主機端直連 |

每帳桌面 profile：**最小** · **XFCE** · **無**。

## 路由

| 項目 | 值 |
|------|-----|
| UI | `/vnc` |
| 公開分享 | `/vnc-share/:token`（無需登入面板；預設 **只讀**） |
| API | `/api/v1/vnc/*` |
| 能力 | `network.vnc`（開埠另需 `firewall.edit`） |
| 安裝 | 軟件橫幅需 **root + `YSK_EXECUTE`** |

## 瀏覽器 Viewer（主路徑）

1. **帳號** 或 **客戶端** → **在瀏覽器開啟**
2. 面板發出短時效票據，經控制面將 RFB 接到用戶瀏覽器（只要可開啟面板即可，無需為 RFB 另建 SSH 隧道）
3. 工具列：重新連線、適合視窗／1:1、畫質、全螢幕、Ctrl+Alt+Del、剪貼簿、分享、截圖、錄影（WebM ≤60 秒）
4. 最多 **4** 個同時工作階段（分頁）
5. **分享連結**（只讀，約 1 小時）：複製後對方開啟 `/vnc-share/:token`

**連出客戶端：** 控制面主機須能以 TCP 連至實際 RFB 目標 — 遠端 `host:port`，或在 **經伺服器代理** 路徑下填寫的 **連線主機**（遠端防火牆須放行）。

## 伺服器流程

1. **安裝** → TigerVNC  
2. **設定** → 預設桌面／解析度／RFB 監聽（預設 **localhost**）  
3. **帳號** → 建立  
4. 密碼 → **啟動**（或由「在瀏覽器開啟」代為啟動）  
5. **在瀏覽器開啟**（建議）  
6. **連線**資料（進階）：舊 noVNC 本機 URL、直連 RFB + UFW  

## 客戶端流程

1. **客戶端** → 新增 `host:port`，並選擇連線路徑（**兩者均在瀏覽器內使用 VNC**）：  
   - **經用戶可達端點**（預設）：公網主機名等；面板 TCP 使用「遠端主機」  
   - **經伺服器代理**：流量經控制面網絡轉發；可選填 **連線主機** 覆寫實際 TCP 目標（例如顯示 `vnc.example.com`，實際連 `10.0.0.9:5901`）  
2. 開啟瀏覽器工作階段前，面板會對解析後的主機做 **RFB TCP 探測**（伺服器代理且有連線主機時連該位址）  
3. **在瀏覽器開啟**  

### 雙路徑與連線主機

| 欄位 | 作用 |
|------|------|
| 遠端主機 | UI 顯示／預設目標 |
| 路徑 | `user_reachable` \| `server_proxy`（皆為瀏覽器路徑；非主機端 `vncviewer`） |
| 連線主機 | 可選；**僅伺服器代理**。有填時控制面對此位址開 TCP；留空則用遠端主機 |

API：`POST/PATCH /api/v1/vnc/client/profiles` 接受 `connectHost`。

## 安全

- 本機帳號 RFB 預設 **localhost**；瀏覽器路徑不會將 RFB 直接暴露於公網 — 僅經面板認證（或分享權杖）的 WebSocket  
- 分享連結預設 **只讀** 且會過期  
- 密碼不會寫入 audit；可選將客戶端密碼存於 dataDir（root 可讀）  
- 無 `YSK_EXECUTE`／非 root：寫入中繼資料；啟動本機桌面會誠實回報 **blocked**  

## 相關

- [VPN](./vpn-ZH.md) — 建議先建立隧道再使用 VNC  
- 防火牆／防護中心 — 埠策略  
