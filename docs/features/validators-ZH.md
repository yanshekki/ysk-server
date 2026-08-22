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
| 清理／轉網絡／快照 | `validators prune` · `switch-network` · `snapshot` | write-host | 轉網絡要先停機並確認清空 |
| 啟動／停止／重啟 | `ysk-server validators start\|stop\|restart --id ID --execute --json` | write-host | |
| 清空鏈資料 | `ysk-server validators clear --id ID --confirm --execute --json` | write-host | 確認為識別碼或 `CLEAR` |
| 刪除實例 | `ysk-server validators delete --id ID --confirm --execute --json` | write-host | 停止 Compose、清空資料、刪除紀錄。確認為識別碼或 `CLEAR`。須 `validators.wipe` |
| 質押憑證／後續步驟 | `ysk-server validators checklist --id ID --json` | read | 與 `GET /api/v1/validators/:id/checklist` 同一資料。只含公開身份。 |
| 重寫官方 compose | `ysk-server validators rewrite-compose --id ID --execute --json` | write-host | 重生官方 yaml（host P2P 寫入 `public_addr`）。沒有 `--execute` 為 dry-run。 |
| 儲存 compose YAML | `ysk-server validators compose-write --id ID --file PATH --execute --json` | write-host | 與 `PUT /compose` 相同。內容須含 `ysk-server validators` 或實例識別碼。 |
| 軟件釘選 | `ysk-server validators software [--refresh] --json` | read | 本機／釘選／官方標籤。 |
| 拉取釘選映像 | `ysk-server validators pull --image IMAGE --tag TAG --execute --json` | write-host | 只允許釘選或已快取的官方標籤。 |
| 刪除遺留目錄 | `ysk-server validators leftover-remove --path PATH --confirm NAME --execute --json` | write-host | 確認為目錄名稱。須 root + execute。 |
| 容器統計 | `ysk-server validators stats --id ID --json` | read | 該 compose 專案的 `docker stats --no-stream`。 |
| 官方版本 | `ysk-server validators versions --client ID [--refresh] --json` | read | GitHub 清單 + 釘選。 |
| 指定客戶端標籤 | `ysk-server validators set-version --id ID --client ID --tag TAG --confirm ID --execute --json` | write-host | 會重生 compose。 |
| Cardano 出塊熱鑰 | `ysk-server validators producer-keys --id ID --kes-file P --vrf-file P --opcert-file P --confirm ID --execute --json` | write-host | 只接受熱鑰。`producer-detach` 卸下。 |
| 設定 | `ysk-server validators settings [--auto-clear 0\|1] --json` | write-panel | 自動清理遺留目錄的排序。 |

風險：`read` · `write-panel` · `write-host`（見 [docs-standard-ZH.md](../docs-standard-ZH.md)）。

## CLI 快速開始

```bash
ysk-server validators list --json
ysk-server validators chains --json
ysk-server validators disk --json
ysk-server validators get --id eth-hoodi-1 --json
ysk-server validators create --chain eth --network hoodi --profile minimal --json
YSK_EXECUTE=1 ysk-server validators create --chain eth --network hoodi --profile minimal --execute --json
```

完整參數：[../cli/reference-ZH.md](../cli/reference-ZH.md)。

## 誠實原則

- 沒有 `--execute` 時，變更主機的命令維持 **dry-run**。  
- 真正套用仍須 `YSK_EXECUTE=1`（多數情況亦須 root）。  
- **written**（資料目錄）≠ **applied**（實際主機）。  
- 沒有 `--execute` 的建立屬 **written**（規格 + compose）。啟動／停止／清空維持 **blocked**。  
- **NEAR：** 質押池合約存放此節點的 `public_key`，不是伺服器 IP。同儕使用 **主機 P2P 埠**（`ports.p2p`，多數為 24567）的 `public_addr`。RPC 僅本機。面板永不寫入 `validator_key.json`，亦不代發 `create_staking_pool`。RPC 未就緒不代表尚未產生金鑰。此改動之前建立的實例仍宣告容器埠 24567，直至你重寫 compose。  
- **節點起好之後：** 實例頁列出編號步驟與「請不要」。  
  - AVAX：RPC 可答後顯示 NodeID + BLS。  
  - NEAR：stake public key、factory、可複製的 `create_staking_pool`（讀磁碟，不等 RPC）。  
  - Cosmos：共識公鑰、`chain-id`、可複製的 `create-validator`（gas 與節點 `0.005uatom` 一致）。同儕用主機 P2P（`tcp://WAN:{p2p}`）。  
  - ETH：只跑執行層 + beacon，沒有 validator client。複製本機 beacon URL；Hoodi 實例只連 Hoodi launchpad。  
  - Solana：`--no-voting`；identity pubkey 來自 `getIdentity`。  
  - Polkadot：全節點，沒有 `--validator`；面板不呼叫 `rotateKeys`。  
  - Sui／Aptos：fullnode／公共全節點，不是驗證者進程。  
  - Cardano：先作 relay；本頁掛熱鑰；拓撲填公開 IP + P2P 埠（面板不探測 WAN）。  
  - `validator-ready` 只是磁碟檔案，不是「此進程已在出塊」。

## 僅面板 ⚠️

| 介面 | 原因 |
|---------|-----------|
| 說明分頁 | 操作說明；CLI 可用 `--help`／文件 |
| NetIO 即時輪詢 | 列表頁圖表。`validators list` 摘要在 Docker 有回應時已含最近 rx／tx |
| Compose YAML 編輯器 | 互動編輯；儲存用 `compose-write` |

## 相關

- [面板 ↔ CLI 對照](../cli/panel-parity-matrix-ZH.md)  
- [CLI 參考](../cli/reference-ZH.md)  
- [操作誠實原則](../architecture/ops-honesty-ZH.md)  
- [原始設計備註](../_archive/validators-design.md)  
