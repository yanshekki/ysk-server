# 郵件外部設定

> 語言：中文 | [English](./external-setup.md)

## 用途

操作員必須在控制平面**之外**完成的步驟：域名商 DNS、VPS PTR、Port 25 解封或 SMTP 中繼。

## 原則

1. 面板產生記錄建議並執行檢查。  
2. 面板**不能**代你改域名商 DNS 或雲端 PTR。  
3. 外部待辦須保持可見直至達標。  

## 清單

| 範圍 | 負責方 | 動作 |
|------|--------|------|
| MX／SPF／DKIM／DMARC | DNS 供應商 | 按面板建議發布記錄 |
| PTR | VPS／雲主控台 | 對齊郵件主機名／HELO |
| Port 25 | 主機商 | 解封外送 25 **或** 設定中繼 |
| 聲譽 | 操作員 | 暖機；監察 DNSBL |

## CLI

```bash
ysk-server email dns --domain example.com --json
ysk-server email deliverability --domain example.com --json
```

## 相關

[deliverability-ZH.md](./deliverability-ZH.md) · [../features/email-ZH.md](../features/email-ZH.md)
