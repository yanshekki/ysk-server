# 伺服器管理員：生產上線 Checklist

> 語言：中文 | [English](./admin-ops-checklist.md)

> 本頁為對應英文運維文件的香港書面語版；命令與路徑保持原文以便複製。

> **最短路徑：** 見 [go-live.md](./go-live.md)（一頁 go-live）。

YSK 是 **Admin 控制面**。生產能力取決於 **root + `YSK_EXECUTE=1`**。  
記住：**寫入管理檔 ≠ 已套用到系統 ≠ 對外可連**。

## 0b. 安全加固（setup / readiness）

- [ ] `setup` 使用 **強密碼**（非 `admin`）；本地 dev 先可用 `--allow-insecure-defaults`
- [ ] 登入若見 `mustChangePassword` → 立即改密
- [ ] admin **2FA**；可選 `security.require_admin_totp_strict=1`
- [ ] listen 預設 **127.0.0.1**；`0.0.0.0` 要有 UFW / reverse proxy
- [ ] `dataDir` `chmod 750`；readiness 項 `admin-password` / `datadir-perms` / `listen-bind`

## 0. 模式

| 模式 | 條件 | 期望 |
|------|------|------|
| degraded | 非 root 或無 EXECUTE | 可玩 UI／dataDir；系統套用會 blocked |
| production_capable | root + `YSK_EXECUTE=1` | useradd、systemd、nginx reload、FPM、郵件／DB apply |

```bash
# 建議生產
export YSK_EXECUTE=1
# 以 root 跑 control plane（systemd unit）
ysk-server readiness --data-dir /var/lib/ysk-server --json
# productionReady 應為 true（nginx + node 在 PATH 等）
```

## 1. 控制面

- [ ] `dataDir` 存在且可寫（例 `/var/lib/ysk-server`）
- [ ] `ysk-server serve` 或 systemd unit 已 enable
- [ ] 管理員密碼已改；建議開 **安全 → 2FA**
- [ ] 面板埠（預設 API 9287／Vite 開發 9173）已防火牆允許

## 2. 架站主路徑（專案）

- [ ] 建專案 → **資源** 建立系統用戶（`ysks_*` + `/home/ysk-server-{id}`）
- [ ] 執行環境已安裝對應 toolchain（Node/PHP/…）
- [ ] **部署** 成功；notes 無「degraded 當 production」誤解
- [ ] **網絡** 發佈 Nginx；`nginx -t` + reload（需 EXECUTE）
- [ ] SSL：LE 或上傳；到期可在 Dashboard 見
- [ ] PHP：全域 php.ini 已儲存；要系統 conf.d 再「套用到系統」；專案覆寫後重新 FPM／部署

**勿用**「執行環境 → PHP → FPM／站點」當每站主流程（嗰個係系統 demo／工具）。

## 2b. IPv4 + IPv6 雙棧

公網邊緣（Nginx／UFW／DNS／防護）支援 **IPv4 與 IPv6**；專案應用進程仍綁 `127.0.0.1`（本機上游，刻意不做公網 `::`）。

- [ ] 主機已獲公網 IPv6（或至少 loopback `::1` 測本地）
- [ ] `/etc/default/ufw` 內 **`IPV6=yes`**（否則 UFW 規則可能只寫 v4）
- [ ] Nginx 站點 conf 含 `listen 80` **與** `listen [::]:80`（HTTPS 同理 443）— `nginx -t` 後 reload
- [ ] DNS：有 v6 時 apex／www／mail 加 **AAAA**；SPF 可加 `ip6:`
- [ ] 防護中心：白名單／手動 ban 可填 v6 或 CIDR（例 `2001:db8::/32`）
- [ ] CF-only 檔含 **IPv4 + IPv6** CF 段（腳本 notes 會標段數）
- [ ] FTPS：預設僅 IPv4；要 v6 時在服務頁選「IPv6（可 mapped）」再套用
- [ ] 郵件 Postfix 管理檔 `inet_protocols = all`
- [ ] 驗證：`curl -4` / `curl -6` 打站；`ufw status` 見 v6 規則

**勿**把 Node／PHP 上游改成公網 IPv6 listen；保持 reverse proxy → `127.0.0.1:PORT`。

## 3. DNS／外網

- [ ] 面板 zone 已寫；**權威** named/pdns 已 reload（或 registrar 指到本機）
- [ ] A/AAAA／必要 CNAME 在 **registrar 或權威** 正確
- [ ] 郵件：MX、SPF、DKIM、DMARC 記錄已加（見 DNS external checklist）

## 4. 郵件（若用）

- [ ] 郵件套用／bootstrap 已跑（EXECUTE）
- [ ] postfix/dovecot **is-active**
- [ ] **PTR／Port 25** 由主機商處理（面板唔自動搞 deliverability）
- [ ] 測本地投遞；國際投遞另驗

## 5. 資料庫

- [ ] 引擎服務 running
- [ ] provision 成功 **或** 已手動跑面板給出的 SQL
- [ ] 應用連線字串用專案隔離憑證

## 6. 備份／Cron

- [ ] **備份 → 操作** 跑一次「備份所有專案」（0 專案＝無事可做，唔算失敗）
- [ ] 下載／還原抽測
- [ ] 「登記每日排程」後到 **Cron → 狀態 → 安裝到系統 crontab**
- [ ] 確認指令含：`ysk-server backup all --data-dir '…'`
- [ ] （可選）restic：啟用 + **必填 password** + PATH 有 `restic`

## 7. 安全

- [ ] 防火牆／Fail2ban 已套用（EXECUTE）
- [ ] SFTP：sshd 片段已安裝（若用金鑰登專案用戶）
- [ ] API keys 僅給自動化；唔入 git

## 8. 誠實驗收

```text
written  — dataDir 有檔
applied  — /etc 或 systemctl 已變
online   — 埠聽緊、HTTP 200、郵件可投
```

任何一步 notes 寫 blocked／requiresRoot／requiresExecute → **先滿足權限再重試**，唔好當 UI bug。

## 相關

- [spec-readiness.md](./spec-readiness.md)  
- [root-apply.md](./root-apply.md)  
- [project-isolation.md](./project-isolation.md)  
- [backup.md](./backup.md)  
- [runtime-tuning.md](./runtime-tuning.md)  

## Selection-first 表單
- 可枚舉用 radio/checkbox/select；禁止無必要手打
- 密碼／域名／IP／指令／PEM 才用 text
