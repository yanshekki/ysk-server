# 功能：驗證者節點 (Beta)

> Language: [English](./validators.md) | 中文

## 用途

在此單一主機安裝與管理 **L1 驗證者就緒節點**（Ethereum、Avalanche、NEAR、Cardano，以及 Phase 2：Bitcoin、Cosmos Hub、Sui、Aptos、Polkadot、Solana）。面板負責軟件與設定。**私鑰由你自行保管。**

**非目標：** 託管私鑰、自動質押、歸檔節點、保證收益。

## 面板

| 項目 | 值 |
|------|--------|
| 路徑 | `/validators` |
| 導覽鍵 | `validators` |
| 主要分頁／動作 | 節點 · 磁碟 · 說明 |
| 能力 | `validators.read`（列表）· `validators.manage`（稍後變更）· `validators.wipe`（稍後清空） |
| RBAC | 檢視者可列出；操作者可管理；管理員可清空 |

## 能力對照

| 面板動作 | CLI | 風險 | 備註 |
|--------------|-----|------|-------|
| 列出實例 | `ysk-server validators list --json` | read | |
| 支援鏈 | `ysk-server validators chains --json` | read | |
| 磁碟用量 | `ysk-server validators disk --json` | read | |
| 取得實例 | `ysk-server validators get --id ID --json` | read | |
| 建立／安裝 | `ysk-server validators create --chain … --network … --execute --json` | write-host | Dry-run 寫規格；套用須 Docker Compose。ETH 可用 `--el`／`--cl`。未裝 Docker 會連去 `/docker` |
| Mithril 還原 | `ysk-server validators mithril --id ID --confirm MITHRIL --execute --json` | write-host | 只限 Cardano；認證快照，無私鑰 |
| 升級 | `ysk-server validators upgrade --id ID --execute --json` | write-host | 健康檢查失敗會回滾舊映像 |
| 啟動／停止／重啟 | `ysk-server validators start\|stop\|restart --id ID --execute --json` | write-host | |
| 清空鏈資料 | `ysk-server validators clear --id ID --confirm --execute --json` | write-host | 確認為識別碼或 `CLEAR` |

風險：`read` · `write-panel` · `write-host`（見 [docs-standard-ZH.md](../docs-standard-ZH.md)）。

## CLI 快速開始

```bash
ysk-server validators list --json
ysk-server validators chains --json
ysk-server validators disk --json
ysk-server validators get --id eth-hoodi-1 --json
```

完整參數：[../cli/reference-ZH.md](../cli/reference-ZH.md)。

## 誠實原則

- 沒有 `--execute` 時，變更主機的命令維持 **dry-run**。  
- 真正套用仍須 `YSK_EXECUTE=1`（多數情況亦須 root）。  
- **written**（資料目錄）≠ **applied**（實際主機）。  
- 沒有 `--execute` 的建立屬 **written**（規格 + compose）。啟動／停止／清空維持 **blocked**。

## 僅面板 ⚠️

| 介面 | 原因 |
|---------|-----------|
| 說明分頁 | 操作說明；CLI 可用 `--help`／文件 |

## 相關

- [面板 ↔ CLI 對照](../cli/panel-parity-matrix-ZH.md)  
- [CLI 參考](../cli/reference-ZH.md)  
- [操作誠實原則](../architecture/ops-honesty-ZH.md)  
- [原始設計備註](../_archive/validators-design.md)  
