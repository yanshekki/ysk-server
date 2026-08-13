# SQL engine switch — 真機 E2E 驗收清單（S6）

**目標：** 有用戶資料庫時，MySQL ↔ MariaDB 互斥切換全流程可重複、可回復。  
**前置：** `YSK_EXECUTE=1`、root、面板已部署最新 `main`。

## 1. 準備

- [ ] 主機只運行一種引擎（或由面板偵測）
- [ ] 建立測試庫與表，例如：

```bash
mysql -e "CREATE DATABASE ysk_e2e; USE ysk_e2e; CREATE TABLE t(i INT); INSERT INTO t VALUES (1);"
# 或 mariadb 客戶端同等
```

- [ ] 記下目前 flavor：`systemctl is-active mysql mariadb`、`mysql --version` / `mariadbd --version`

## 2. 預覽（面板）

- [ ] 軟件安裝／SQL 頁出現互斥提示
- [ ] 切換對話框：步驟編號只顯示一次（無 1. 1 重覆）
- [ ] 文案為 zh-HK，引擎名 **MariaDB**（非「Maria資料庫」）
- [ ] 列出用戶庫含 `ysk_e2e`
- [ ] 必須勾選同意 + 輸入 `SWITCH`

## 3. 執行切換

- [ ] 確認後 API/面板結果 `ok: true`（或誠實失敗，無「已啟動」假成功）
- [ ] 過程 notes 有：dump → purge 對方 → install 目標 → import
- [ ] 來源引擎套件已卸載／不可再當 server
- [ ] 目標 unit `active`

## 4. 資料校驗

```bash
# 目標客戶端
mysql -N -e "SELECT COUNT(*) FROM ysk_e2e.t;"
# 期望 1
```

- [ ] 表數據正確
- [ ] 權限／用戶（若有匯出 grants）可用或有誠實 note

## 5. 失敗路徑（可選）

- [ ] 故意錯誤密碼／dump 失敗 → 來源仍運行，無 purge
- [ ] FROZEN：切換後若 MySQL 起不到，面板有「解除凍結」／health 修復

## 6. 反向再切

- [ ] 切返原本引擎，數據仍在（或按產品 note 可從 dump 路徑還原）

## 結果記錄

| 項 | 結果 | 備註 |
|----|------|------|
| 正向 switch | | |
| 數據 | | |
| 反向 switch | | |
| 假成功訊息 | 無／有 | |

**通過標準：** 正向 + 數據 + 無誠實度回歸即 S6 **done**。

---

## 7. 程式門禁（CI / 本機）

```bash
pnpm e2e:sql-switch        # 單元 + DTO + export + checklist
pnpm e2e:sql-switch-live   # Docker：MySQL 建庫寫入 → dump → MariaDB import → 驗證 row
```

驗收內容：

- `ysk-server-core`：`sql-engine-switch` + `mysql-frozen` + `sql-engine-health` 單元測試
- shared DTO：`needs_exclusive_switch` / `healthFindings` 等欄位仍在
- core export：`previewSqlEngineSwitch`、`diagnoseSqlEngine`、`planRepairFromFindings`、`recoverMysqlAfterEngineSwitch`…
- 本 checklist 檔存在且含 FROZEN／反向／通過標準章節
- Docker live：有用戶數據（`ysk_e2e.t` = 42）跨引擎 dump/import 通過
- （可選）本機 `systemctl is-active mysql|mariadb` 快照；雙 active 會 WARN
- 本機 **apt 互斥 purge/install**（§1–6）仍建議 root + `YSK_EXECUTE` 再跑一次

**S6 done 標準：** `e2e:sql-switch` + `e2e:sql-switch-live` 綠（碼 + 有數據路徑）；§1–6 本機 apt 為運維加強項。
