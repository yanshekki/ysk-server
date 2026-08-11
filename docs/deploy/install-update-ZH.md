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

- **更新**（`/updates`）是套件清點、面板自身更新、掃描排程的唯一入口。
- 舊「軟件中心」（`/software`）會導向 `/updates`。安裝軟件請到各功能頁。
- 伺服器工作 `updates.scan` 按可設定間隔（預設 24 小時）執行：只刷新清點與面板檢查，**不會自動 apt upgrade**。
- 側欄數字來自 `GET /api/v1/updates/summary`（可升級套件數 + 面板更新）。
