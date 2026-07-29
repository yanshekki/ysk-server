# YSK Server — 給 AI Agent 用

**原則：用 CLI 管機，唔好發明第二套工具。**

| 做咩 | 用咩 |
|------|------|
| 運維本機／此控制面 | `ysk-server … --json` |
| 面板 LLM 任務 | AI 任務頁 + allowlist |
| 多機 edge fleet | **實驗** — 見下文；做事應轉 call CLI |

完整命令： [docs/cli/reference.md](../cli/reference.md)  
機器可讀目錄： [commands.json](./commands.json)

---

## 必讀規則

1. **永遠加 `--json`**（或只讀 JSON stdout）
2. **禁止** 把 LLM 原文當 shell 執行
3. 改系統要 `YSK_EXECUTE=1`（+ 多數情況 root）；否則結果係 `blocked`，唔係假成功
4. 高風險 tool：先 dry-run / 等人批（`ysk-server tools` / API approval）
5. Exit code：
   - `0` ok  
   - `1` 一般失敗  
   - `2` 參數／validation  
   - `3` blocked（無權限／無 EXECUTE）  
   - `4` not found  

---

## 5 分鐘 runbook

```bash
# 健康
ysk-server readiness --data-dir .ysk --json

# 專案
ysk-server projects list --json
ysk-server projects create --name demo --runtime node --runtime-version 20 --json
ysk-server projects deploy --id <uuid> --json

# 服務矩陣 / 防護
ysk-server services matrix --json
ysk-server defense status --json
ysk-server defense whitelist --action list --json
# ban 需 EXECUTE： ysk-server defense ban --ip 1.2.3.4 --json

# 工具（allowlist）
ysk-server tools --json
ysk-server tools run --tool sys.info --dry-run --json

# 自然語言 → 計劃（唔自動執行）
ysk-server ask "check system info" --json
# 要執行（需權限）：加 --execute
```

---

## 能做／唔能做

| 能 | 唔能 |
|----|------|
| list / create / deploy 專案 | 任意 `rm -rf` / 無白名單 shell |
| readiness、hosting helpers | 假裝 applied（無 EXECUTE 時） |
| tools dry-run + 審批流 | 繞過 allowlist |
| 讀狀態、寫管理檔（panel） | 當 root 萬能 |

---

## 面板「AI Agent」

控制面可 **登記／排隊**；邊緣要跑：

```bash
ysk-server agent run --control-plane http://127.0.0.1:9287 --id edge-1
```

**而家 `onCommand` 只 echo**（除非已接 CLI 包裝）。  
真實運維請直接用上方 CLI，唔好靠面板 fleet。

---

## Skill 入口

見 [SKILL.md](./SKILL.md) — 貼去 Cursor / Claude / Codex 當系統提示。
