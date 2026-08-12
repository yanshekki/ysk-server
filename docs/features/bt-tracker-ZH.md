# BT Tracker 與 WebTorrent 檔案分享

> 語言：中文（香港書面語）| [English](./bt-tracker.md)

## 用途

自架 **BitTorrent Tracker**（[bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)）與 **程序內 WebTorrent 做種**，讓檔案分享可選 **直接 HTTP**、**BT／WebTorrent** 或 **兩者**。BT 分享會產生 `.torrent` 與 magnet；面板 seeder 向本機 Tracker announce；訪客用公開分享頁或外部客戶端。

**非目標：** 對外開放任意第三方 torrent 的公開 Tracker；僅 DHT 主路徑；取代 CDN。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/bt-tracker` |
| 相關 | `/files`（分享模式 + BT 欄）、公開 `/share/:token` |
| 分頁 | 概覽 · Torrent（有任務時顯示 Jobs）· 設定 · 關於 |
| 能力 | 檔案／系統控制平面 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 狀態／announce | `ysk-server bt-tracker status` | read | 隨產品附帶 |
| 啟動／停止 | `ysk-server bt-tracker start\|stop [--execute]` | write-host | 面板：程序內。CLI start：detached worker + pid。**啟動**會同步 UFW 期望埠；**停止**會清掉 `ysk-svc:bt-tracker:*` |
| 設定 | `ysk-server bt-tracker settings get\|set …` | write-panel | 寫入 JSON + 期望暴露埠。**運行中改埠需重啟** |
| 重新做種 | `ysk-server bt-tracker restore` | write-panel | `serve` 開機亦會 |
| Swarm 表 | `ysk-server bt-tracker torrents` | read | 優先程序內即時 swarm |
| 任務 | `ysk-server bt-tracker jobs [--id ID]` | read | 大型分享建 torrent 佇列 |
| 建立 BT 分享 | `ysk-server files shares create --mode bt\|both …` | write-panel | `.torrent` + 做種 |
| 分享 BT 統計 | `ysk-server files shares bt-stats --id ID` | read | 種子／下載者／速度 |

## CLI 速查

```bash
ysk-server bt-tracker settings set \
  --http-port 8000 --udp-port 6969 \
  --public-host example.com --ws --autostart --json

export YSK_EXECUTE=1
ysk-server bt-tracker start --execute --json

ysk-server files shares create --path big.zip --mode both --root public --json

ysk-server bt-tracker torrents --json
ysk-server files shares bt-stats --id SHARE_ID --json
ysk-server bt-tracker jobs --json
```

## Day-N 檢查清單

自動化：

```bash
pnpm e2e:bt-tracker
```

手動：

1. `ysk-server serve`  
2. BT Tracker → 設 **公開主機** 與埠 → **啟動**（或 autostart）  
3. **網絡存取**：訪客在主機外時勿長期「僅本機」；放行 **8000/tcp**（若開 UDP 一併放行）  
4. 檔案 → 分享 → **BT** 或 **兩者**  
5. 開啟 `/share/:token` → 瀏覽器 WebTorrent／magnet／`.torrent`  
6. Torrent 分頁確認 swarm；大檔可能短暫出現背景任務  

## 埠與 announce

| 埠／路徑 | 角色 |
|----------|------|
| **8000**（預設） | Tracker HTTP + WS |
| UDP（可選，如 **6969**） | 傳統 UDP announce |
| **6881–6889** | 做種 peer 監聽範圍 |
| **`/api/v1/public/bt-tracker`** | **同源 WS／HTTP 代理**到本機 Tracker（HTTPS 分享頁必須用；否則 `ws://:8000` 會被 mixed content 擋） |

- Magnet／announce **只用**面板 `publicAnnounceHost` + 埠。  
- **未設公開主機**時 magnet **不**再硬塞 `127.0.0.1`。  
- Seeder 只向本機 Tracker **announce 一次**（避免種子數永遠顯示 2）。  
- 瀏覽器 WebTorrent 使用面板 build **自帶** `webtorrent.min.js`（非第三方 CDN），並強制 `announce` 走同源代理。

## 誠實邊界

- Tracker 是控制平面／worker 內的 **Node 進程**，不是 apt 套件。  
- 面板 Start 與 `serve` 同進程；CLI Start 偏好 **detached worker**。  
- `serve` 開機會 `restoreBtSharesOnBoot`（autostart 或已有 BT 分享）。  
- Tracker 未運行仍可能寫出 `.torrent`，但 peer 發現差。  
- 運行中改埠要 **先停再開**。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 公開分享 UX（模式掣、進度、統計） | 訪客 HTTP |
| 瀏覽器 WebTorrent | 訪客；資源由面板 build，Tracker 走同源代理 |

## 相關

- [檔案與 FTP](./files-ftp-ZH.md)  
- [CLI 參考](../cli/reference-ZH.md)  
- [WebTorrent](https://github.com/webtorrent/webtorrent) · [bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)
