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
5. Exit code（嚴格）：
   - `0` ok  
   - `1` 一般失敗  
   - `2` 參數／validation（缺 flag、zone 名無效）  
   - `3` blocked（無權限／無 EXECUTE／allowlist）  
   - `4` not found  
   - `5` host command 失敗

---

## 5 分鐘 runbook

```bash
# 健康 / 主機
ysk-server readiness --data-dir .ysk --json
ysk-server host --json
ysk-server host metrics --json

# 專案
ysk-server projects list --json
ysk-server projects create --name demo --runtime node --runtime-version 20 --json
ysk-server projects deploy --id <uuid> --json

# 服務矩陣 / 防護
ysk-server services matrix --json
ysk-server defense status --json
ysk-server defense whitelist --action list --json
# ban 需 EXECUTE： ysk-server defense ban --ip 1.2.3.4 --json

# DNS zone（寫管理檔；--validate/--reload 需 EXECUTE）
ysk-server dns zones --json
ysk-server dns zone --zone example.com --ip YOUR.PUBLIC.IP [--ipv6 2001:db8::1] --json
# 等同：ysk-server hosting dns-zone --zone … --ip …

# Logs（journal / 白名單 path / 專案 log）
ysk-server logs sources --json
ysk-server logs query --source journal: --lines 100 --grep error --json
ysk-server logs journal --unit nginx.service --lines 50 --json
ysk-server logs overview --json

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
| readiness、hosting / dns / logs | 假裝 applied（無 EXECUTE 時） |
| tools dry-run + 審批流 | 繞過 allowlist |
| 讀狀態、寫管理檔（panel） | 當 root 萬能 |
| 查 journal／log 來源 | 讀任意 path（只限 catalog allowlist） |

---

## 面板「AI Agent」（實驗）

控制面可 **登記／排隊**；邊緣要跑：

```bash
ysk-server agent run --control-plane http://127.0.0.1:9287 --id edge-1
```

排隊 payload 優先用 CLI 包裝（edge 已支援）：

```json
{ "cli": ["host", "overview", "--json"] }
{ "cli": ["projects", "list"] }
{ "cli": ["logs", "query", "--source", "journal:", "--lines", "50"] }
```

面板「下指令」預設亦係呢啲 CLI preset。  
本機運維仍直接 call `ysk-server … --json` 最快；fleet 只係多機分發。

---

## Skill 入口

見 [SKILL.md](./SKILL.md) — 貼去 Cursor / Claude / Codex 當系統提示。
