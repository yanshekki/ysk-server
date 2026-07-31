# CLI 參考

> 語言：中文 | [English](./reference.md)

**二進位：** `ysk-server`  
**另見：** [overview-ZH.md](./overview-ZH.md) · [parity-ZH.md](./parity-ZH.md) · [../agent/commands.json](../agent/commands.json)

全域旗標與結束碼見 [overview-ZH.md](./overview-ZH.md)。

除另有說明外，可按需加上 `--json`、`--data-dir PATH`。

---

## setup

初始化 `dataDir`、設定、document store、管理員、systemd unit 範本。

```bash
ysk-server setup --data-dir /var/lib/ysk [--admin-username U] [--admin-password P] [--listen-host 127.0.0.1] [--listen-port 9287] [--locale zh-HK] [--dry-run] [--force] [--json]
```

弱密碼／預設密碼會被拒絕，除非本機開發設 `YSK_ALLOW_INSECURE_DEFAULTS=1`。

## serve

啟動 HTTP API + 靜態 Web UI（需已建置 `apps/web`）。

```bash
ysk-server serve [--config PATH] [--data-dir PATH] [--host 127.0.0.1] [--port 9287] [--web-root PATH]
```

## update

自我更新檢查／套用（套用需網絡 + EXECUTE）。

```bash
ysk-server update [--check] [--latest VERSION] [--apply] [--json]
```

## system

```bash
ysk-server system unit-install [--enable] [--data-dir PATH] [--execute]
```

寫入控制平面 systemd unit；enable／start 需 root + EXECUTE。

## version | help

```bash
ysk-server version
ysk-server help [--locale zh-HK|zh-CN|en]
```

---

## projects

```bash
ysk-server projects list
ysk-server projects get --id UUID
ysk-server projects create --name NAME --domain D [--runtime node|php|static|…]
ysk-server projects deploy --id UUID [--entry FILE] [--port N] [--fpm] [--execute]
ysk-server projects stop --id UUID [--execute]
ysk-server projects health --id UUID
ysk-server projects backup --id UUID
ysk-server projects git-deploy --id UUID [--ref BRANCH] [--execute]
ysk-server projects isolation list|provision|provision-all|backfill-owners …
ysk-server projects template …
```

部署路徑：systemd → PM2 → pidfile（Node）；FPM 或 `php -S`（PHP）；nginx root（static）。見 [../features/projects-ZH.md](../features/projects-ZH.md)。

## templates

列出／套用應用範本（node-starter、static-site、wordpress-php…）。

```bash
ysk-server templates list|apply …
```

## hosting

底層架站輔助（預設 dry-run）：

```bash
ysk-server hosting nginx|nginx-sync [--execute]
ysk-server hosting mysql-provision|postgres-provision|redis-provision [--execute]
ysk-server hosting dns-zone --zone X --ip A.B.C.D …
ysk-server hosting email-bootstrap|email-deliverability|email-apply …
ysk-server hosting ftps-apply|firewall-apply|runtimes|runtime-install …
```

完整子命令請執行 `ysk-server hosting`。

## nginx | ssl | dns

```bash
ysk-server nginx status|list|test|sync [--execute]
ysk-server ssl list|get …
ysk-server dns zones|zone --zone X --ip A.B.C.D …
```

`dns` 為 AI 友好別名，指向 hosting DNS 輔助。

## backup

```bash
ysk-server backup list [--q TEXT]
ysk-server backup status
ysk-server backup all
ysk-server backup restore …
ysk-server backup delete …
ysk-server backup schedule [--install] [--execute]
ysk-server backup control-plane
ysk-server backup settings get|set …
ysk-server backup restic …
```

## store

```bash
ysk-server store status|export|import|migrate --to json|sqlite|postgres …
```

見 [../architecture/state-store-ZH.md](../architecture/state-store-ZH.md)。

## files

沙箱檔案管理（public 或 `project:ID` 根）：

```bash
ysk-server files list|stat|read|write|mkdir|rm|rename|copy|move|chmod …
ysk-server files trash list|restore|purge
ysk-server files shares list
ysk-server files upload --dir REL --file LOCAL
ysk-server files webdav status|token|disable
```

## cron

```bash
ysk-server cron list|create|delete|enable|disable|run|install|status …
```

安裝 crontab 需 EXECUTE。

## email

```bash
ysk-server email domains list|create|get …
ysk-server email mailboxes list|create …
ysk-server email deliverability --domain example.com
ysk-server email bootstrap --domain D --ip A.B.C.D [--install]
ysk-server email dns --domain D
```

PTR／Port 25 屬外部。見 [../features/email-ZH.md](../features/email-ZH.md)。

## users | packages | rbac | audit | security

```bash
ysk-server users list|create …
ysk-server packages list
ysk-server rbac list|show|audit
ysk-server audit [--q TEXT] [--limit N]
ysk-server security status
ysk-server security sessions list|revoke|revoke-others [--user U]
ysk-server security api-keys list|create|delete …
```

## ssh-key | ssh-2fa

```bash
ysk-server ssh-key list|create|import|public|export|install|delete …
ysk-server ssh-2fa list|enroll|confirm|install|pam|retire …
```

SSH TOTP ≠ 面板 TOTP。

## defense | protection

```bash
ysk-server defense status|firewall|fail2ban|ban|unban|whitelist|stack-apply|presets|timeline …
ysk-server protection …   # defense 別名
```

## cdn

```bash
ysk-server cdn nodes list|upsert|delete|probe|drain …
ysk-server cdn sites list|get|upsert|delete …
ysk-server cdn render|apply|purge|dns-sync|from-project|dashboard|health-loop …
```

## agents | agent

```bash
ysk-server agents runtimes|probe|fleet list|fleet register|fleet commands|register|commands …
ysk-server agent run --control-plane URL --id AGENT_ID [--group g]
```

Fleet：已註冊 ≠ 已連線（需 heartbeat）。入隊需 Bearer；公開路徑僅限 poller。

## logs | host | health | readiness | doctor | services | db-cluster

```bash
ysk-server logs sources|query|journal|overview …
ysk-server host overview|metrics|network …
ysk-server health [--url http://host:port/health]
ysk-server readiness|doctor [--json]
ysk-server services …
ysk-server db-cluster list|get|create|plan …
```

## migrate

```bash
ysk-server migrate inventory|host|post|status|resume …
```

## tools | ask

```bash
ysk-server tools [--json]
ysk-server tools run --tool NAME [--arg k=v] [--dry-run|--execute]
ysk-server ask "自然語言" [--execute]
```

工具受 allowlist 與防護模式約束。

---

## 功能文件對照

| 命令域 | 功能頁 |
|--------|--------|
| projects, templates, hosting | [../features/projects-ZH.md](../features/projects-ZH.md) |
| email | [../features/email-ZH.md](../features/email-ZH.md) |
| files | [../features/files-ftp-ZH.md](../features/files-ftp-ZH.md) |
| backup, cron | [../features/backups-cron-ZH.md](../features/backups-cron-ZH.md) |
| security, users, rbac | [../features/security-auth-ZH.md](../features/security-auth-ZH.md) · [../features/users-rbac-ZH.md](../features/users-rbac-ZH.md) |
| defense | [../features/defense-ZH.md](../features/defense-ZH.md) |
| cdn, agents | [../features/cdn-agents-ZH.md](../features/cdn-agents-ZH.md) |
| logs, host | [../features/logs-metrics-ZH.md](../features/logs-metrics-ZH.md) |


---

## 高頻旗標（細節）

### setup

| 旗標 | 含義 |
|------|------|
| `--data-dir PATH` | 控制平面目錄（可自動建立） |
| `--admin-username`／`--admin-password` | 首位管理員 |
| `--listen-host`／`--listen-port` | serve 預設綁定 |
| `--locale zh-HK\|zh-CN\|en` | 管理員與預設 UI 語言 |
| `--dry-run` | 只輸出計劃 |
| `--force` | 安全範圍內允許重跑 |
| `--json` | 結構化結果 |

### projects deploy

| 旗標 | 含義 |
|------|------|
| `--id UUID` | 專案 id |
| `--entry FILE` | Node 入口（如 server.js） |
| `--port N` | 監聽埠 |
| `--fpm` | 優先 PHP-FPM |
| `--execute` | 真實部署（需 EXECUTE；systemd 常需 root） |

無 `--execute`：只計劃／寫 dataDir 管理 unit。

### backup

| 子命令 | 說明 |
|--------|------|
| `list`／`status` | 唯讀庫存 |
| `all` | 完整備份回合 |
| `schedule --install` | 安裝排程（EXECUTE） |
| `control-plane` | 備份控制平面狀態 |
| `restic …` | 已設定時的 restic 輔助 |
| `settings get\|set` | 遠端／排除設定 |

### email deliverability

| 旗標 | 含義 |
|------|------|
| `--domain` 或域名 id | 目標郵件域名 |
| `--json` | 項目 + 誠實 notes |

絕不宣稱全球 inbox 成功。

### security

| 子命令 | 含義 |
|--------|------|
| `status` | 2FA 旗標、管理員計數 |
| `sessions list\|revoke\|revoke-others` | 以 `--user` 管理工作階段 |
| `api-keys list\|create\|delete` | 操作員 API 金鑰；建立時 token 只顯示一次 |

### defense

| 子命令 | 含義 |
|--------|------|
| `status` | 防護堆疊快照 |
| `firewall`／`fail2ban` | 子系統狀態／計劃 |
| `ban`／`unban`／`whitelist` | IP 動作（上線需 EXECUTE） |
| `stack-apply`／`presets`／`timeline` | 防護中心操作 |

### store

| 子命令 | 含義 |
|--------|------|
| `status` | 後端種類 + 計數 |
| `export`／`import` | document 快照 JSON |
| `migrate --to json\|sqlite\|postgres` | 切換後端 |

### readiness／doctor

唯讀生產門檻。未達標可非 0 結束（JSON 仍有用）。

```bash
ysk-server readiness --json
ysk-server doctor --json
```
