# 郵件可送達性

> 語言：中文 | [English](./deliverability.md)

## 用途

對郵件域名做即時與儲存檢查：MX、SPF、DKIM、DMARC、PTR、外送 Port 25、DNSBL，以及可選中繼與暖機指引。

## CLI

```bash
ysk-server email deliverability --domain example.com --json
ysk-server email bootstrap --domain example.com --ip A.B.C.D --json
ysk-server hosting email-deliverability --domain example.com --json
```

## 報告項目

| 項目 | 含義 |
|------|------|
| MX／SPF／DKIM／DMARC | DNS 發布檢查 |
| PTR | 反向 DNS 與郵件主機名 |
| Port 25 | 外送 TCP 25 探測 |
| DNSBL | 多清單聲譽 |
| 中繼 | Port 25 被封時的設定 |
| 暖機 | 分階段寄信指引 |

## 誠實邊界

- 面板**從不**保證 Gmail／Outlook 進 inbox。  
- PTR 與 Port 25 屬 VPS／網絡供應商。  
- 權威 DNS 必須在外部發布。  

## 相關

[external-setup-ZH.md](./external-setup-ZH.md) · [../features/email-ZH.md](../features/email-ZH.md)
