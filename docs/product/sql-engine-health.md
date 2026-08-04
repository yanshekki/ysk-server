# SQL engine health（大眾化設計）

## 問題

MySQL／MariaDB 起唔到，原因可以係組合：

- Debian **FROZEN**
- **my.cnf** 仍指向另一引擎
- **殘留 plugin .cnf**（如 MariaDB `provider_*`）
- **資料目錄未初始化**
- unit **failed**
- **3306 埠衝突**

若只為單一症狀寫 if/else，產品會變成「永遠追 bug」。

## 模型

```
diagnose → findings[] → repairPlan[] → execute(confirm)
```

| 層 | 職責 |
|----|------|
| **diagnose** | 獨立檢查項，產出穩定 `finding.id` |
| **plan** | 由 findings 決定**通用步驟順序**（stop → clear freeze → sanitize config → init datadir → start → verify） |
| **execute** | 逐步執行；需 `confirm: true` 先跑破壞性步驟 |

模組：`packages/core/src/hosting/sql-engine-health/`

## 面板

- 服務已裝但未運作 → 紅框 + **診斷列表**（每項 finding 有 i18n）
- **檢查並修復服務** → 確認對話框 → 跑完整計劃
- **啟動服務** 失敗時亦會自動套用同一計劃（已有 root + 系統變更）

## API

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/v1/system/db/{mysql\|mariadb}/status` | 含 `frozen`、`datadirEmpty`、`healthFindings` |
| POST | `/api/v1/system/db/{mysql\|mariadb}/unfreeze` | `{ confirm: true }` → 通用修復計劃 |

（路徑名 unfreeze 保留兼容；語意已是 **repair**。）

## 擴展

新增檢查：在 `diagnose.ts` 加 finding → 在 `planRepairFromFindings` 掛 action。  
**唔使**再為單一錯誤開專用 API。
