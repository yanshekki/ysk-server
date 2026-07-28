# Runtime 調校（php.ini + Node/Python/Go/Rust）

面板可設計各執行環境的全域數值；部署時寫入對應機制。**儲存 ≠ 線上已生效**。

## PHP php.ini

| 層級 | 路徑 | 生效方式 |
|------|------|----------|
| 全域 | `dataDir/php/{ver}/panel-ini.json` + `conf.d/ysk-panel.ini` | 「套用到系統」→ `/etc/php/{ver}/fpm/conf.d/99-ysk-panel.ini` + reload FPM |
| 專案覆寫 | `dataDir/php/projects/{projectId}.json` | 部署／套用 FPM pool 時合併進 `php_admin_value` / `php_admin_flag` |

API：

- `GET/PUT /api/v1/hosting/php/ini?version=8.2`
- `POST /api/v1/hosting/php/ini/apply`（需 `YSK_EXECUTE` + root）
- `GET/PUT /api/v1/projects/:id/php-ini`

Catalog 分組：資源、上傳、session、錯誤、opcache、安全、時區、其他 + extra/raw。

## 其他 runtime（env 調校）

| Kind | 儲存 | 部署注入 |
|------|------|----------|
| node | `dataDir/runtimes/node/{ver}/tuning.json` | systemd Environment、PM2 env、pidfile env（含 `NODE_OPTIONS`） |
| python / go / rust | `dataDir/runtimes/{kind}/{ver}/tuning.json` | 同上 |

API：`GET/PUT /api/v1/hosting/runtimes/{node|python|go|rust}/tuning?version=`

重新**部署專案**後才進行程；僅儲存不會 reload 現有 unit。
