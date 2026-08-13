# 上線

> 語言：中文 | [English](./go-live.md)

> 本頁為對應英文運維文件的香港書面語版；命令與路徑保持原文以便複製。

YSK Server 是 **單機控制平面**。生產 = **root + `YSK_EXECUTE=1` + 強密碼 + 2FA + 安全 listen**。

完整運維清單見 [admin-ops-checklist.md](./admin-ops-checklist.md)。本頁是 **最短上線路徑**。

---

## 0. 一分鐘決策

| 你有 | 模式 |
|------|------|
| 非 root 或無 `YSK_EXECUTE` | **degraded** — 可寫 dataDir；系統套用會 blocked（正常） |
| root + `YSK_EXECUTE=1` + nginx + node | 可達 **production_capable** |

```bash
export YSK_EXECUTE=1
ysk-server readiness --data-dir /var/lib/ysk-server --json
# productionReady == true 先當「主機可真 apply」
```

---

## 1. 安裝控制平面

```bash
# 強密碼（禁止 admin/admin 除非本地 dev）
export YSK_ADMIN_PASSWORD='use-a-long-random-secret'
ysk-server setup --data-dir /var/lib/ysk-server --host 127.0.0.1 --port 9287

# 本地 dev 先可以用弱密碼（不要用在公網）
# ysk-server setup --allow-insecure-defaults --data-dir .ysk
```

| 檢查 | 做什麼 |
|------|------|
| 密碼 | 最少 8 字、不是 `admin` / 常見弱密碼；否則 setup **拒絕**（除非 `--allow-insecure-defaults`） |
| Listen | 預設 **127.0.0.1**；公網 0.0.0.0 要有 UFW / reverse proxy |
| dataDir | `chmod 750`（或 700）；不要 world-writable |

---

## 2. 啟動

```bash
# 開發
ysk-server serve --config /var/lib/ysk-server/config.json

# 生產 unit
ysk-server system unit-install --enable --data-dir /var/lib/ysk-server
systemctl status ysk-server   # 名稱以 unit 模板為準
```

- 登入後：**立即改密**（若曾 insecure bootstrap，login 會標 `mustChangePassword`）
- **Security → 2FA**：admin 必須開 TOTP（可開 `security.require_admin_totp`）
- 嚴格模式：`security.require_admin_totp_strict=1` → 未 2FA 不准 admin session

---

## 3. 安全最低線（上線前）

- [ ] 已改預設密碼；readiness **admin-password** = ready  
- [ ] admin **2FA** 已開  
- [ ] listen **不是** 裸奔公網（或已有防火牆 + TLS reverse proxy）  
- [ ] dataDir 權限合理（readiness **datadir-perms**）  
- [ ] `YSK_EXECUTE=1` **只** 在可信主機 / systemd Environment  
- [ ] 防火牆放行 80/443；**管理埠 9287 不要** 直接對全世界  

---

## 4. 第一個站（黃金路徑）

1. 建 Project → 系統用戶（`ysks_*` + home）  
2. Deploy（Node / PHP / static）— 查看 notes 是 systemd 定 degraded  
3. 發佈 Nginx + SSL  
4. `curl -I https://your.domain`  

CLI 對等（agents 優先）：

```bash
ysk-server projects list --json
ysk-server readiness --json
ysk-server nginx …   # 見 docs/cli/reference.md
```

---

## 5. 郵件 / DNS（可選）

- 面板寫 zone ≠ registrar 已指；PTR / Port 25 **主機商負責**  
- 見 admin-ops-checklist §3–4  

---

## 6. 備份

```bash
ysk-server backup all --data-dir /var/lib/ysk-server
# 再裝每日 cron（面板 Cron → 安裝到系統 crontab）
```

---

## 7. 誠實紅線（不要當成 bug）

| 現象 | 含義 |
|------|------|
| `ok: false` / blocked | 無 EXECUTE 或無 root — **fail-closed 正確** |
| 已寫入 conf 服務未跑 | 要 apply / reload / install unit |
| productionReady=false | 未達 root+EXECUTE+nginx+node 等硬門檻 |

---

## 8. 相關文件

| 文件 | 用途 |
|------|------|
| [admin-ops-checklist.md](./admin-ops-checklist.md) | 完整管理員 checklist |
| [spec-readiness.md](./spec-readiness.md) | readiness 定義 |
| [production-mvp.md](./production-mvp.md) | MVP 生產邊界 |
| [../cli/reference.md](../cli/reference.md) | CLI 全表 |
| [../agent/README.md](../agent/README.md) | AI agent 規則 |

---

## 9. CLI 快速對照

```text
ysk-server setup [--admin-password] [--allow-insecure-defaults] [--host] [--port]
ysk-server serve [--host 127.0.0.1] [--port 9287]
ysk-server readiness --json
ysk-server doctor          # 若已提供
ysk-server projects list --json
```

**Panel 有的運維能力，CLI 應對等** — 缺就報 issue / 補 catalog。
