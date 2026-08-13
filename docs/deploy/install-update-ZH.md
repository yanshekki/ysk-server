# 安裝與更新

> 語言：中文 | [English](./install-update.md)

安裝 monorepo 或套件；使用 `ysk-server setup` 與 `ysk-server update`。

```bash
pnpm install && pnpm build
ysk-server setup --data-dir /var/lib/ysk --json
ysk-server update --check --json
```

見 [../getting-started/install-ZH.md](../getting-started/install-ZH.md)。

## 面板「更新」頁

- **更新**（`/updates`）是全機中心：面板 npm + catalog 服務 + runtime + 其餘 apt。CLI：`ysk-server updates hub --json`（與 `GET /api/v1/updates` 同一套 `entries`）。`ysk-server update` 只負責產品自身更新。
- 舊「軟件中心」（`/software`）會導向 `/updates`。安裝軟件請到各功能頁。
- 伺服器工作 `updates.scan` 按可設定間隔（預設 24 小時）執行：只刷新清點與面板檢查，**不會自動 apt upgrade**。
- 側欄數字來自 `GET /api/v1/updates/summary`（可升級套件數 + 面板更新）。

## 功能頁一鍵安裝／解除安裝

- 各功能頁有 **一鍵安裝** 與 **解除安裝…**（安裝橫幅／版本列）。
- 解除流程：影響說明 → 保留／徹底清除資料 → 雙重確認（勾選 + 輸入 `UNINSTALL`）。
- 安裝與解除均以 SSE 串流日誌；右下角 **OpsStreamDock** 可縮小，任務繼續在背景跑。
- API：`POST /api/v1/system/software/install`、`…/uninstall-preview`、`…/uninstall`（`text/event-stream` 即時 log）。
- 預設 **保留** 設定與資料；**purge** 只刪白名單路徑。
- 需 `YSK_EXECUTE` + root，否則誠實回報 blocked。
