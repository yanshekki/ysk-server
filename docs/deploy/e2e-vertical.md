# E2E 垂直：Node / PHP / Email（D2）

> Language: English | [中文](./e2e-vertical-ZH.md)

真機可驗證路徑（**唔假成功**）。無 root 必須 PASS；root + `YSK_EXECUTE=1` 為增強。

## 一鍵

```bash
# 非 root 合格線（CI / 開發機）
pnpm e2e:real-ops
# 等同
bash scripts/e2e-real-ops.sh

# root 主機路徑（非 root 會 SKIP exit 0）
sudo YSK_EXECUTE=1 bash scripts/e2e-hosting-root.sh
# 或
pnpm e2e:hosting-root
```

## 覆蓋矩陣

| 垂直 | 非 root 驗證 | root 增強 |
|------|--------------|-----------|
| **Node** | create → deploy → 真 bind port → curl → health → nginx conf → stop | systemd unit / enable 路徑 |
| **PHP** | create (wordpress-php) → `deploy-php` `forceBuiltin` → `php -S` listen → curl → stop | FPM pool + OS isolation provision |
| **Static** | deploy-static + try_files conf | nginx -t / reload |
| **Email** | domain + mailbox + bootstrap plan + **deliverability**（`deliveryGuaranteed` 永唔因本地 probe 變 true） | package install / postfix apply |
| **Backup CLI** | `backup control-plane` / `list` / `status` | schedule `--install` |
| **CLI email** | `hosting email-deliverability` | — |

## API 關鍵路徑

```http
POST /api/v1/projects                          # runtime node|php|static
POST /api/v1/projects/:id/deploy               # Node 真 listen
POST /api/v1/projects/:id/deploy-php           # body { forceBuiltin?: true }
POST /api/v1/projects/:id/deploy-static
POST /api/v1/projects/:id/stop
POST /api/v1/email/domains
POST /api/v1/email/domains/:id/mailboxes
GET  /api/v1/email/domains/:id/deliverability
GET  /api/v1/email/deliverability/overview
POST /api/v1/email/bootstrap                   # plan 預設
```

## CLI

```bash
ysk-server projects create --name demo --runtime node --json
ysk-server projects deploy --id UUID
ysk-server projects backup --id UUID
ysk-server backup all|list|status|control-plane --json
ysk-server hosting email-deliverability --domain example.com --json
```

## 誠實條件

| 情況 | 期望 |
|------|------|
| 無 `php` binary | PHP deploy `ok:false` + notes；E2E **唔當全域 FAIL**（Node/Email 仍要過） |
| 無 root / 無 EXECUTE | `degraded: true`；crontab install blocked |
| Email deliverability | 本地 DNSBL/PTR probe **唔**標 `deliveryGuaranteed: true` |
| Redis/Postgres provision 無執行權 | `ok:false` 或未 executed — 禁止假 ok |

## 相關

- [real-ops.md](./real-ops.md) — 原垂直定義  
- [backup.md](./backup.md) — D1 備份  
- [../email/](../email/) — 郵件運維  
- [go-live.md](./go-live.md) — 上線清單  
