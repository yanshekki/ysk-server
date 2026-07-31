# CLI 概覽

> 語言：中文（香港書面語）| [English](./overview.md)

**二進位：** `ysk-server`  
**完整命令：** [reference-ZH.md](./reference-ZH.md)  
**機器目錄：** [../agent/commands.json](../agent/commands.json)

## 全域旗標

| 旗標／環境變數 | 含義 |
|----------------|------|
| `--json` | 標準輸出結構化 JSON（AI 優先） |
| `--data-dir PATH` | 控制平面資料目錄 |
| `--config PATH` | setup 產生的 `config.json` |
| `--locale CODE` | `zh-HK` · `zh-CN` · `en`（亦可用 `YSK_LOCALE`／`LANG`） |
| `--execute`／`--apply` | 嘗試真實主機變更 |
| `--help`／`--version` | 說明／版本 |

未加 `--execute` 時，主機變更類命令維持 **dry-run**。真實套用仍需 `YSK_EXECUTE=1`（常需 root）。

## 結束碼

| 碼 | 含義 |
|----|------|
| 0 | 成功（含合法 dry-run 計劃） |
| 1 | 錯誤 |
| 2 | 驗證／用法錯誤 |
| 3 | 被阻擋（EXECUTE／root／權限） |
| 4 | 找不到 |
| 5 | 主機命令失敗 |

請解析 JSON：`ok`、`blocked`、`dryRun`、`executed`、`code`、`message`、`notes`。

## 安全

1. 先做唯讀探測（`readiness`、`host`、`projects list`）。  
2. `--execute` 前先看計劃 JSON。  
3. 不要把 `written` 當成已上線。  

## 語言

```bash
ysk-server help --locale zh-HK
ysk-server security help --locale en
YSK_LOCALE=zh-CN ysk-server store status --json
```

## 命令分組

| 組 | 命令 |
|----|------|
| 生命週期 | `setup` `serve` `update` `system` `version` `help` |
| 專案 | `projects` `templates` `hosting` `nginx` `ssl` `dns` |
| 資料 | `backup` `store` `files` `cron` `migrate` |
| 郵件 | `email` |
| 安全 | `users` `packages` `rbac` `audit` `security` `ssh-key` `ssh-2fa` `defense` `protection` |
| 邊緣 | `cdn` `agents` `agent` |
| 觀測 | `logs` `host` `health` `readiness` `doctor` `services` `db-cluster` |
| AI | `tools` `ask` |
