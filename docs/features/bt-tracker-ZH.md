# BT Tracker 與 WebTorrent 檔案分享

> 語言：中文（香港書面語）| [English](./bt-tracker.md)

## 用途

自架 **BitTorrent Tracker**（[bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)）與 **程序內 WebTorrent 做種**，讓檔案分享可選 **直接 HTTP**、**BT／WebTorrent** 或 **兩者**。BT 分享會產生 `.torrent` 與 magnet；面板 seeder 向本機 Tracker announce；訪客用公開分享頁或外部客戶端。

**非目標：** 對外開放任意第三方 swarm 的公開 Tracker；僅 DHT 主路徑；取代 CDN；另裝 qBittorrent／Transmission／aria2。

**資料庫**是本機 WebTorrent 客戶端：用戶加入 `.torrent`（或 magnet）並選擇 Files 儲存資料夾。缺檔就下載，齊了就做種。常用 Tracker 分頁的額外 announce 會合併進這個客戶端——**不會**令本機 Tracker 變成對外公開 Tracker。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/bt-tracker` |
| 相關 | `/files`（分享模式 + BT 欄）、公開 `/share/:token` |
| 分頁 | 概覽 · Torrent（資料庫）· Tracker（常用 announce）· 設定 · 關於 |
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
| 加入資料庫 | `ysk-server bt-tracker add --file FILE\|--magnet URI --root public --path DIR` | write-panel | 先寫入；WebTorrent 喺 `serve` 跑 |
| 資料庫暫停／繼續／移除 | `library` · `pause` · `resume` · `remove [--delete-files]` | write-panel | |
| 常用 Tracker | `bt-tracker trackers add\|remove\|enable\|disable --url URL` | write-panel | 合併入 WebTorrent announce |
| 建立 BT 分享 | `ysk-server files shares create --mode bt\|both …` | write-panel | `.torrent` + 做種 |
| 分享 BT 統計 | `ysk-server files shares bt-stats --id ID` | read | 種子／下載者／速度 |

## 資料庫（下載／做種）

面板 **Torrent** 分頁是 WebTorrent **資料庫**，不只是 swarm 表。

1. **加入 Torrent** — 拖放或選擇 `.torrent`（≤ 8 MiB），或貼上 magnet。  
2. 讀取後顯示名稱、大小、檔案清單，以及會額外使用多少常用 Tracker。  
3. 選擇 **Files** 資料夾（`public` 或 `project:<id>`）。預設 `public/downloads/<名稱>`。不可選任意主機路徑。  
4. **開始** — 缺的分片下載到該資料夾；檔案已齊則做種。  
5. 暫停／繼續／開啟資料夾／移除（保留檔或連檔刪除）。檔案分享做種仍列出，標籤為 **分享**。

CLI `add` **只寫入資料庫列**。下載／做種在 `ysk-server serve`（面板）行程內執行。`restore`／開機會恢復未暫停項目。

## 常用 Tracker

面板 **Tracker** 分頁（`?tab=tracker`）是操作員 announce 清單（設定內 `extraTrackers`）。預設空白，不內建第三方 URL。

- 只接受 `http://` `https://` `udp://` `ws://` `wss://`。最多 32 條。重複略過。  
- 資料庫加入／繼續時，與 `.torrent`／magnet 原有 announce **合併**。  
- 檔案分享做種仍只向本機 loopback Tracker **announce 一次**（種子數誠實），並同時向已啟用的常用 URL announce，方便外站 peers。  
- 常用 URL **不會**寫入公開分享 magnet（公開 magnet 仍只用 `publicAnnounceHost`）。  
- 改完清單後，**套用到現有做種** 才更新運行中項目；新加入一律用已儲存清單。

```bash
ysk-server bt-tracker trackers
ysk-server bt-tracker trackers add --url http://tracker.example/announce
```

## CLI 速查

```bash
ysk-server bt-tracker settings set \
  --http-port 8000 --udp-port 6969 \
  --public-host example.com --ws --autostart --json

export YSK_EXECUTE=1
ysk-server bt-tracker start --execute --json

# 已有檔案 → 公開分享 + 做種
ysk-server files shares create --path big.zip --mode both --root public --json

# 匯入 .torrent（只寫入）。要下載或做種請開面板／serve。
ysk-server bt-tracker add --file ./film.torrent --root public --path downloads/film --json
ysk-server bt-tracker library --json
ysk-server bt-tracker trackers add --url udp://tracker.example:6969 --json

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
4. **Torrent** → 加入 Torrent → 選擇儲存資料夾 → 確認進度後為 **做種中**；檔案在 Files 可見  
5. 可選：**Tracker** 分頁 → 加入 announce URL → 套用到現有做種  
6. 檔案 → 分享 → **BT** 或 **兩者**（與資料庫匯入分開）  
7. 開啟 `/share/:token` → 瀏覽器 WebTorrent／magnet／`.torrent`  
8. 大型分享建 torrent 時可能短暫出現 **任務**  

## HTTP API

認證：Bearer。前綴：`/api/v1/system/bt-tracker`。

| 方法 | 路徑 | 作用 |
|------|------|------|
| GET | `/status` `/settings` `/torrents` `/jobs` | 讀取 |
| POST | `/start` `/stop` `/restore` | 變更 Tracker／重新做種 |
| PATCH | `/settings` | 含 `extraTrackers` |
| POST | `/library/inspect` | 解析 `.torrent`（base64）或 magnet — 不下載（本文最多 12 MiB） |
| POST | `/library` | 加入（`saveRoot`、`saveRelPath`）— 於 `serve` 啟動 WebTorrent |
| GET | `/library` `/library/:id` | 即時進度 |
| POST | `/library/:id/pause` `/library/:id/resume` | |
| DELETE | `/library/:id?deleteFiles=0\|1` | |
| POST | `/library/apply-trackers` | 把常用 URL 套到現有做種 |

訪客 Tracker 代理仍是 `/api/v1/public/bt-tracker`（無需登入）。

## 埠與 announce

| 埠／路徑 | 角色 |
|----------|------|
| **8000**（預設） | Tracker HTTP + WS |
| UDP（可選，如 **6969**） | 傳統 UDP announce |
| **6881–6889** | 做種 peer 監聽範圍 |
| **`/api/v1/public/bt-tracker`** | **同源 WS／HTTP 代理**到本機 Tracker（HTTPS 分享頁必須用；否則 `ws://:8000` 會被 mixed content 擋） |

- Magnet／announce **只用**面板 `publicAnnounceHost` + 埠。  
- **未設公開主機**時 magnet **不**再硬塞 `127.0.0.1`。  
- 沒有點的短主機名（例如 `demo-server`）不會用作 announce；優先 FQDN（`hostname -f`）或可用 IP。  
- Seeder 只向本機 Tracker **announce 一次**（避免種子數永遠顯示 2）。  
- 瀏覽器 WebTorrent 使用面板 build **自帶** `webtorrent.min.js`（非第三方 CDN），並強制 `announce` 走同源代理。

## 誠實邊界

- Tracker 是控制平面／worker 內的 **Node 進程**，不是 apt 套件。  
- 面板 Start 與 `serve` 同進程；CLI Start 偏好 **detached worker**。  
- `serve` 開機會 `restoreBtSharesOnBoot`（autostart 或已有 BT 分享），再恢復未暫停的 **資料庫** 項目。  
- Tracker 未運行仍可能寫出 `.torrent`，但 peer 發現差。第三方 torrent 仍用檔案內 announce，加上常用 Tracker。  
- 運行中改埠要 **先停再開**。  
- 資料庫儲存位置只限 Files 沙箱。引擎是產品附帶的 **WebTorrent**，不是 qBittorrent／Transmission／aria2。  
- CLI `add` 不會在 CLI 行程內下載（該行程會結束）。  
- 常用 Tracker 預設空白；產品不附送「推薦」公共清單。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 公開分享 UX（模式掣、進度、統計） | 訪客 HTTP |
| 瀏覽器 WebTorrent | 訪客；資源由面板 build，Tracker 走同源代理 |

## 相關

- [檔案與 FTP](./files-ftp-ZH.md)  
- [CLI 參考](../cli/reference-ZH.md)  
- [WebTorrent](https://github.com/webtorrent/webtorrent) · [bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)
