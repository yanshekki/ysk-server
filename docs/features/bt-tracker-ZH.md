# BT Tracker 與 WebTorrent 檔案分享

> 語言：中文（香港書面語）| [English](./bt-tracker.md)

## 用途

自架 **BitTorrent Tracker**（[bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)）與 **程序內 WebTorrent 做種**，讓檔案分享可選 **直接 HTTP 下載**、**BT／WebTorrent** 或 **兩者皆有**。每個分享會產生 `.torrent`，經面板 Tracker 交換 peers，並在面板與公開 `/share/:token` 頁顯示即時 swarm 數據。

**非目標：** 對外開放任意第三方 torrent 的公開 Tracker；僅 DHT、無本機 Tracker 的分享；取代商用 CDN。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/bt-tracker` |
| 相關 | `/files`（分享對話框模式 + BT 統計）、公開 `/share/:token` |
| 導航鍵 | `btTracker` |
| 主要分頁 | 概覽 · Torrent 列表 · 設定 · 關於 |
| 能力 | 檔案／系統（與檔案同一控制平面） |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 狀態／announce 網址 | `ysk-server bt-tracker status` | read | 依賴隨產品附帶 — 永遠「已安裝」 |
| 啟動／停止 Tracker | `ysk-server bt-tracker start\|stop [--execute]` | write-host | 程序內監聽埠 |
| 設定（埠、公開主機、WS、自動啟動） | `ysk-server bt-tracker settings get\|set …` | write-panel | 開防火牆屬另一步（暴露／UFW） |
| Torrent／swarm 表 | `ysk-server bt-tracker torrents` | read | 合併本機做種速度 |
| 建立 BT 分享 | `ysk-server files shares create --mode bt\|both --path …` | write-panel | 產生 `.torrent` 並做種 |
| 分享 BT 統計 | `ysk-server files shares bt-stats --id ID` | read | 種子／下載者／速度 |

## CLI 速查

```bash
# 設定 peers 會連線的公開 announce 主機
ysk-server bt-tracker settings set --http-port 8000 --public-host example.com --json

# 啟動 Tracker（生產環境建議 EXECUTE）
export YSK_EXECUTE=1
ysk-server bt-tracker start --execute --json

# 同時提供直接下載 + BT
ysk-server files shares create --path big.zip --mode both --root public --json

# 即時統計
ysk-server bt-tracker torrents --json
ysk-server files shares bt-stats --id SHARE_ID --json
```

## 埠

| 埠 | 角色 |
|----|------|
| **8000**（預設） | HTTP + WebSocket announce（`/announce`，瀏覽器 WebTorrent 用 WS） |
| UDP（可選，預設關閉） | 傳統 UDP Tracker |
| **6881–6889** | 做種 peer 監聽範圍（防火牆芯片目錄） |

請在 BT Tracker 頁用 **網絡暴露**／防火牆芯片（`8000 BT tracker`、`6881-6889 BT peers`）。下載者在公網時才考慮公開模式。

## 誠實邊界

- Tracker 為控制平面（`ysk-server serve`）**程序內 Node 服務**，非獨立 apt 套件。  
- **面板啟動／停止**與 **autostart** 會隨面板進程常駐。一次性 CLI `bt-tracker start` 只在該 CLI 進程期間有效 — 生產請用面板或 `autostart`。  
- **`ysk-server serve` 開機**時會執行 `restoreBtSharesOnBoot`：若已開 `autostart` 或存在 BT 分享則啟動 Tracker，並為仍有磁碟上 `.torrent` 的分享重新做種（跳過 `seedStatus: stopped`）。  
- 未啟動 Tracker 時仍可寫出 `.torrent`，但 peers 未必能互相發現。  
- `publicAnnounceHost` 空白時 magnet 使用 `127.0.0.1` — 僅適合同機測試。  
- 生產環境建議 EXECUTE；本機 listen 有時仍可不經 EXECUTE 成功。

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 公開分享 BT UI（magnet／.torrent／統計） | 訪客 HTTP |
| 瀏覽器 WebTorrent 下載 | 訪客按需從 CDN 載入 WebTorrent；伺服器仍會做種 |

## 相關

- [檔案與 FTP](./files-ftp-ZH.md)  
- [CLI 參考 — files／bt-tracker](../cli/reference-ZH.md)  
- [WebTorrent](https://github.com/webtorrent/webtorrent) · [webtorrent-cli](https://github.com/webtorrent/webtorrent-cli) · [bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker)  
