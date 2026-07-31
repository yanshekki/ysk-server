# 狀態庫

> 語言：中文 | [English](./state-store.md)

> 本頁為對應英文運維文件的香港書面語版；命令與路徑保持原文以便複製。

控制平面狀態（users / projects / settings / audit / sessions / api_keys …）用 **document store**：整份 `StoreData` 快照持久化。  
**唔**係完整 relational 每表 schema（`schema.ts` 預留下一階段）。

## 後端

| Kind | 預設 | 依賴 | 檔案 / 連線 | 穩定度 |
|------|------|------|-------------|--------|
| **json** | ✅ | 無 | `dataDir/ysk.json`（atomic rename） | **生產預設** |
| **sqlite** | `YSK_STORE=sqlite` | `sql.js`（純 JS wasm） | `dataDir/ysk.sqlite` + JSON mirror | **支援**（單機） |
| **postgres** | `YSK_STORE=postgres` | 可選 `pg` | `YSK_DATABASE_URL=postgres://…` | **實驗**（document blob 一表） |

## 環境變數

```bash
# default
YSK_STORE=json

# SQLite document file
YSK_STORE=sqlite
# → opens dataDir/ysk.sqlite（仍寫 mirror JSON 方便 rescue）

# Postgres (experimental document blob)
YSK_STORE=postgres
YSK_DATABASE_URL=postgres://ysk:secret@127.0.0.1:5432/ysk_cp
# 或 DATABASE_URL=…
```

路徑推斷：`--data-dir` / config 的 `ysk.sqlite` / `*.db` 結尾會自動選 sqlite；`postgres://` URL 自動選 postgres。

## CLI（panel 對等）

```bash
ysk-server store status --data-dir /var/lib/ysk --json
ysk-server store export --out /backup/ysk-store.json
ysk-server store import --in /backup/ysk-store.json
ysk-server store migrate --to sqlite --out /var/lib/ysk/ysk.sqlite
ysk-server store migrate --to json --out /var/lib/ysk/ysk.json
# postgres: 先 export JSON，設 YSK_STORE=postgres 後 import 或 migrate --to postgres
```

`store status` 回報：`kind`、`location`、users/projects 計數、可選 lastBackup。

## 誠實邊界

| 項目 | 說明 |
|------|------|
| Document blob | 單 row / 單檔 JSON body；**非** per-table SQL 查詢 |
| SQLite 實作 | `sql.js` child process（避免 native better-sqlite3 平台 segfault） |
| Postgres | 需額外套 `pg`；persist 經 child process（較慢）；適合未來 multi-writer 前的實驗 |
| 多進程寫入 | JSON/SQLite **單 writer**；多實例勿共用 json 檔 |
| Relational | `schema.ts` 只係預留；**未**實作 ORM / 每表 migration |
| Backup | control-plane tar 仍包 `ysk.json`；跨 backend 用 `store export` 最穩 |

## 遷移建議（json → sqlite）

1. `ysk-server store export --data-dir /var/lib/ysk --out /backup/snapshot.json`  
2. 停 `serve`  
3. `ysk-server store migrate --to sqlite --out /var/lib/ysk/ysk.sqlite --data-dir /var/lib/ysk`  
4. 設 `YSK_STORE=sqlite`（systemd Environment=）  
5. `ysk-server store status --json` 確認 `kind=sqlite` + counts  
6. 再開 `serve`；保留 snapshot.json 直至驗證通過  

## 遷移建議（→ postgres 實驗）

1. Export JSON 如上  
2. 建庫：`CREATE DATABASE ysk_cp;`  
3. `YSK_STORE=postgres YSK_DATABASE_URL=postgres://…`  
4. `store import --in snapshot.json` 或 `migrate --to postgres`  
5. status 確認；**生產前**評估延遲與單 writer  

## Readiness

`ysk-server readiness` / `doctor` 會報告 store kind 與 last backup 線索（`last_backup_run`）。  
document-mode 完成標準：json 預設穩、sqlite 可 migrate、postgres 可實驗、CLI 全覆蓋、文件誠實。

## 故障救援

| 情況 | 做法 |
|------|------|
| sqlite 壞 / 打唔開 | 用 mirror `ysk.json` 或 export 還原：`YSK_STORE=json` |
| import 後 count 0 | 檢查 JSON 是否完整 `StoreData`（有 `users` 陣列） |
| postgres 連線失敗 | status/readiness fail-closed；回退 json |

## 相關

- `packages/core/src/db/document-store.ts`  
- `packages/core/src/db/schema.ts`（未來 relational）  
- [backup.md](./backup.md) — control-plane tar + store export  
- [admin-plane-100.md](./admin-plane-100.md) — 控制平面完成定義
