# 運維誠實契約

> 語言：中文（香港書面語）| [English](./ops-honesty.md)

YSK **不會**在只寫了計劃或 `dataDir` 檔案時，假裝主機變更已成功。

## 套用狀態

規範型別在 `@ysk/shared`（`OpsResultDto`／`ApplyStatus`）。

| 狀態 | 含義 |
|------|------|
| `draft` | 僅控制平面資料列 |
| `written` | 已寫入 dataDir 管理檔；**尚未**上線系統 |
| `applied` | 主機命令／reload 成功 |
| `blocked` | 需要 EXECUTE 及／或 root |
| `failed` | 已嘗試並失敗 |
| `partial` | 部分步驟成功 |

**禁止：** `ok: true` 同時 `blocked: true`，或在 blocked 時標 `applied`。

## CLI 契約

| 結束碼 | 含義 |
|--------|------|
| 0 | 成功（含合法 dry-run 計劃） |
| 1 | 錯誤 |
| 2 | 驗證失敗 |
| 3 | 被阻擋 |
| 4 | 找不到 |
| 5 | 主機命令錯誤 |

危險操作：預設 **dry-run**；要真實變更須 `--execute`（或 `--apply`）**且** `YSK_EXECUTE=1`。

## 操作員檢查

1. 閱讀 JSON 的 `notes`／`blockMessage`。  
2. 確認 `dryRun`／`executed`／`applyStatus`。  
3. 上線前執行 `ysk-server readiness --json`。  

另見：[../deploy/root-execute-ZH.md](../deploy/root-execute-ZH.md) · [../deploy/real-ops-ZH.md](../deploy/real-ops-ZH.md)。
