# 郵件可送達性

> 語言：中文（香港書面語）| [English](./deliverability.md)

## 用途

檢查 MX／SPF／DKIM／DMARC／PTR／Port25／DNSBL，並提供暖機與中繼建議。

## CLI

```bash
ysk-server email deliverability --domain example.com --json
ysk-server email bootstrap --domain D --ip A.B.C.D
```

## 誠實邊界

- **不保證** Gmail／Outlook inbox。  
- PTR、Port 25 屬 VPS／網絡供應商。  
- 權威 DNS 須在外部發布。

詳見英文版與 [../features/email-ZH.md](../features/email-ZH.md)。
