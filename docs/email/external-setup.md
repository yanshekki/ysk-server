# Email Server — 外部設定指引（繁體中文）

YSK Server 可自動安裝與配置 Postfix / Dovecot / OpenDKIM 等**本機**元件，但下列事項必須由你在**域名 DNS 服務商**與 **VPS/雲端供應商**完成，否則郵件極易進垃圾箱或無法寄出。

## 為什麼需要外部設定？

郵件到達率（Deliverability）不只靠伺服器軟體。收件方會驗證：

- MX 是否指向你的郵件主機
- SPF / DKIM / DMARC 是否一致
- 反向 DNS（PTR）是否與 HELO/EHLO 一致
- 出站 Port 25 是否可用
- IP / 域名是否在黑名單

## 系統會產生的 DNS 記錄

| 類型 | 名稱 | 說明 | 重要性 |
|------|------|------|--------|
| A | mail | 指向伺服器 IP | 必須 |
| MX | @ | 指向 mail 主機名 | 必須 |
| TXT | @ | SPF (`v=spf1 mx a ip4:… ~all`) | 必須 |
| TXT | default._domainkey | DKIM 公鑰 | 必須 |
| TXT | _dmarc | DMARC 政策 | 強烈建議 |

Cloudflare：郵件相關記錄請用 **DNS only（灰色雲）**。

### 常見服務商提示

- **Cloudflare**：DNS → Records → 新增；Proxy 狀態關閉
- **Namecheap**：Advanced DNS
- **阿里雲**：雲解析 DNS
- **AWS Route53**：Hosted zone records

## Reverse DNS（PTR）— 最容易忽略

- PTR 只能由 **IP 擁有者**（VPS / 雲）設定
- 應與 Postfix `myhostname` / HELO 一致（例如 `mail.example.com`）
- AWS、GCP 等常需工單申請

## 出站 Port 25

許多雲預設封鎖 TCP 25。請：

1. 向供應商申請解除，或
2. 使用外部 SMTP Relay（YSK Server 支援設定）

## 聲譽與暖機

- 新 IP / 新域名不要大量發信
- 監控 Spamhaus、Barracuda、MSRBL
- 遵循 warm-up 策略

## 健康評分

儀表板顯示例如 `70/100`，並列出缺少的 PTR、DMARC、Port 25 等外部待辦。

## 常見問題

| 現象 | 可能原因 |
|------|----------|
| 信進垃圾箱 | 缺 SPF/DKIM/DMARC/PTR 或 IP 聲譽差 |
| 被拒信 | Port 25 封鎖、PTR 不符、黑名單 |
| 無法寄出 | 供應商封鎖 25；改用 Relay |
