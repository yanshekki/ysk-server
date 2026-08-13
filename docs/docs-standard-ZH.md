# 文件標準（面板 + CLI）

> 語言：中文（香港書面語）| [English](./docs-standard.md)

**範圍：** `docs/` 正式產品文件與根目錄 `README*`。  
**不在範圍：** UI 語言包（`packages/shared/locales`）、歸檔筆記（`docs/_archive/`）。

---

## 1. 目標

1. 每一項**生產面板能力**均有功能手冊說明。  
2. 每一個 **CLI 入口**均列入 CLI 參考，並標明風險與誠實邊界。  
3. **英文**與**香港書面語**（`*-ZH.md`）結構對等。  
4. 操作員與 AI 可由任務 → 面板路徑 → CLI 命令，無須臆測。

---

## 2. 讀者分層（只寫該層所需詳盡度）

| 層 | 讀者 | 主要文件 | 內容 |
|----|------|----------|------|
| **L0 導航** | 所有人 | `INDEX-ZH.md`、`README-ZH.md` | 地圖 + 一句誠實邊界 |
| **L1 操作路徑** | 操作員 | `user-manual/manual-ZH.md` | Day-1…N 流程，連到 L2 |
| **L2 功能手冊** | 操作員／支援 | `features/<domain>-ZH.md` | 面板 + CLI 能力對照表 |
| **L3 CLI 百科** | 操作員／AI | `cli/overview-ZH.md`、`cli/reference-ZH.md` | 旗標、結束碼、各一級命令 |
| **L4 機器目錄** | AI／CI | `agent/commands.json`、`cli/parity-inventory.json` | 機器可讀 |
| **L5 架構／部署** | 開發／SRE | `architecture/`、`deploy/` | 設計與運維深度 |

**勿**在 L2 貼完整 argv 百科；L2 連到 L3 即可。

---

## 3. 唯一真相來源（SSOT）

```
程式（CLI_COMMANDS + routes + FEATURE_SECTIONS）
        │
        ▼
cli-panel-parity.mjs --strict
        →  control-plane-inventory.json + parity-inventory.json
        │
        ├─► features/*        （面板流程 + CLI 對照）
        ├─► cli/reference*    （命令百科）
        ├─► api/overview*     （面板 × CLI × API 前綴）
        └─► agent/commands.json
```

| 關注點 | 權威來源 |
|--------|----------|
| 命令是否存在？ | `apps/server/src/cli.ts` 的 `CLI_COMMANDS` 與 handlers／`cli/cmd-*.ts` |
| 面板導航？ | `apps/web/src/shared/nav/features.ts` |
| HTTP 面？ | `apps/server/src/routes/*` + `docs/api/overview-ZH.md` |
| 缺口狀態 | inventory `--strict`（有閘，未封） |

---

## 4. 語言

| 語系 | 規則 |
|------|------|
| **en** | 專業、簡潔、無行銷腔。命令名、路徑、旗標保持英文。 |
| **zh-HK 書面（`*-ZH.md`）** | **香港書面語**。禁止粵語口語聊天體。技術專名可保留英文（WireGuard、RFB），並附簡短中文說明。 |
| **結構** | 相同標題層級、相同表格列數、相同程式碼區塊數。執行 `node scripts/docs-bilingual-check.mjs`。 |

正式雙語檔案頁首：

```markdown
> Language: English | [中文](./foo-ZH.md)
```

```markdown
> 語言：中文（香港書面語）| [English](./foo.md)
```

### 誠實術語對照

| EN | ZH |
|----|-----|
| dry-run | 試跑／計劃模式（不改主機） |
| blocked | 已阻擋 |
| written | 已寫入（資料目錄） |
| applied | 已套用（主機生效） |
| EXECUTE / `YSK_EXECUTE=1` | 系統變更權限（環境變數） |
| `--execute` | 允許嘗試真實主機變更 |
| panel-only | 僅面板（互動介面） |

---

## 5. 功能手冊範本（L2）

每個 `docs/features/<domain>.md` 與 `-ZH.md` **必須**包含：

1. **用途** — 一句產品定義 + 非目標  
2. **面板** — 路由、主要分頁／操作、能力鍵、RBAC 一句  
3. **能力對照表** — 欄：面板操作 | CLI | 風險（`read`／`write-panel`／`write-host`）| 備註  
4. **CLI 速查** — 可複製範例（含 `--json`；主機突變標 `--execute`）  
5. **誠實邊界** — 試跑、EXECUTE、root、已寫入 ≠ 已套用  
6. **僅面板 ⚠️**（如有）— 例如 VNC 畫布  
7. **相關** — 矩陣、reference、deploy 連結  

骨架：[`features/_TEMPLATE.md`](./features/_TEMPLATE.md) · [`features/_TEMPLATE-ZH.md`](./features/_TEMPLATE-ZH.md)。

風險欄含義：

| 風險 | 含義 |
|------|------|
| `read` | 不變更主機 |
| `write-panel` | 僅控制平面資料 |
| `write-host` | 需 `--execute`，通常亦需 `YSK_EXECUTE=1` 與 root |

---

## 6. CLI 參考規則（L3）

對 `CLI_COMMANDS` 中每個**一級**命令：

- 一個 H2 章節  
- 用途（一行）  
- 子命令表（sub | 用途 | 需 `--execute`？）  
- 1–3 個範例  
- 連到所屬功能手冊（如適用）  

全域旗標與結束碼只寫在 `cli/overview-ZH.md`（reference 指向該處）。

---

## 7. 維護規則

1. 變更 CLI 面 → 盡量同一變更集更新 `cli/reference{,-ZH}.md` 與 `agent/commands.json`。  
2. 變更面板生產能力 → 更新功能手冊能力表。  
3. EN 與 ZH **同一切片**提交，避免分叉。  
4. 表格優先於長文。  
5. 範例須為合法試跑路徑，除非專門說明僅 execute 行為。  
6. 不可臆造命令；以程式或 `ysk-server <cmd>` 用法為準。

### 檢查

```bash
node scripts/cli-panel-parity.mjs      # 程式面板↔CLI（應維持封板）
node scripts/docs-bilingual-check.mjs  # 文件雙語結構
pnpm docs:check                        # 雙語 + cli 對等
```

---

## 8. 文件工作盤點

見 [docs-inventory-ZH.md](./docs-inventory-ZH.md)（域 × 檔案 × 缺口；D0–D5 切片）。

---

## 9. 本計劃明確非目標

- 重寫整份產品 Spec  
- 翻譯全部架構 drain 筆記  
- 改 UI i18n 字串（另案）  
- 重做 CLI（C7 已封板；除非發現真實缺口）

*最後更新：2026-08-12 — D0。*
