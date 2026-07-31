# 郵件

> 語言：中文 | [English](./email.md)

**面板路由：** `/email`、`/email/domains/:id`  
**CLI：** `email`、`hosting email-*`

## 功能

| 區 | 能力 |
|----|------|
| 域名 | DKIM 素材、DNS 建議記錄 |
| 信箱 | dataDir 下 Maildir + maps |
| 可送達性 | 即時 MX／SPF／DKIM／DMARC／PTR／Port25／DNSBL |
| 中繼 | Port 25 被封時 SMTP 中繼 |
| 暖機 | 分階段寄信指引 |
| Webmail | Roundcube 計劃／安裝輔助 |

## CLI

```bash
ysk-server email domains list|create --domain example.com --ip A.B.C.D
ysk-server email mailboxes create --domain example.com --local app
ysk-server email deliverability --domain example.com --json
ysk-server email bootstrap --domain example.com --ip A.B.C.D
ysk-server email dns --domain example.com
```

## 操作員外部步驟

1. 在**域名商／權威 DNS** 發布 MX／TXT。  
2. 在 VPS 主控台設 **PTR** 對齊郵件主機名。  
3. **解封 Port 25** 或設定中繼。  

## 誠實邊界

面板**從不**保證 Gmail／Outlook inbox。PTR 與 Port 25 不由 YSK 控制。

## 相關

[../email/deliverability-ZH.md](../email/deliverability-ZH.md) · [../cli/reference-ZH.md](../cli/reference-ZH.md)
