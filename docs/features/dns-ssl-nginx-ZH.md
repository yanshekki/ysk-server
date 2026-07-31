# DNS、SSL、Nginx

> 語言：中文（香港書面語）| [English](./dns-ssl-nginx.md)

**面板路由：** `/dns`、`/ssl`、`/nginx`  
**CLI：** `dns`、`ssl`、`nginx`、`hosting dns-*|powerdns-*`

## DNS

- dataDir 託管 zone 檔  
- 可選 PowerDNS 輔助／Cloudflare 套用（需 token）  
- 工具存在時可驗證  

```bash
ysk-server dns zones --json
ysk-server dns zone --zone example.com --ip A.B.C.D --json
ysk-server hosting powerdns-status --json
```

## SSL

- 憑證列表、綁定、到期感知  
- 上傳 PEM 或 Let’s Encrypt 相關路徑  
- 無真實憑證 + nginx 發布前不宣稱公開 HTTPS  

```bash
ysk-server ssl list --json
ysk-server ssl get --id … --json
```

## Nginx

- 每專案／託管 conf 在 dataDir  
- EXECUTE+root 時可 `test`／`sync` 到系統 conf.d  

```bash
ysk-server nginx status --json
ysk-server nginx list --json
ysk-server nginx test --json
ysk-server nginx sync --execute --json
```

## 誠實邊界

dataDir **已寫入** conf ≠ 已上線 vhost，直至 sync／reload 成功。註冊商 DNS 屬外部。

## 相關

[projects-ZH.md](./projects-ZH.md) · [../cli/reference-ZH.md](../cli/reference-ZH.md)
