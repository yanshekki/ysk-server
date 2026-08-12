# 電子郵件

> 語言：中文（香港書面語）| [English](./email.md)

## 用途

在主機操作 **郵件網域與信箱**（Postfix／Dovecot 路徑）、DNS 套件、可送達性探測、別名、佇列與可選 SMTP 中繼。

**非目標：** 保證全球 inbox 送達；PTR 與 Port 25 屬外部。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/email`、網域詳情 |
| 導航鍵 | `email` |
| 主要操作 | 網域 · 信箱 · DNS · 可送達性 · 別名 · 佇列 · 中繼 · 網頁郵件 |
| 能力 | 郵件 |
| RBAC | 郵件操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 網域列表／建立／查詢 | `ysk-server email domains …` | write-panel | |
| 信箱列表／建立 | `ysk-server email mailboxes …` | write-panel／write-host | 系統用戶可選 |
| DNS 套件 | `ysk-server email dns --domain …` | read | |
| 可送達性 | `ysk-server email deliverability --domain …` | read | 誠實評分 |
| 引導安裝堆疊 | `ysk-server email bootstrap … [--install]` | write-host | |
| 別名 CRUD | `ysk-server email aliases list\|create\|delete` | write-panel | |
| 佇列列表／清空 | `ysk-server email queue list\|flush --execute` | write-host | flush |
| 中繼讀取／套用 | `ysk-server email relay get\|apply --host …` | write-host | execute 時套用系統 |

## CLI 速查

```bash
ysk-server email domains list --json
ysk-server email deliverability --domain example.com --json
ysk-server email aliases list --domain example.com --json
ysk-server email queue list --json
ysk-server email relay get --json
```

## 誠實邊界

- 可送達性從不宣稱全球 inbox 成功。  
- PTR／Port 25／黑名單需外部處理。  
- 佇列清空與系統郵件套件需 EXECUTE。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 網頁郵件 UI／SSO 瀏覽器流程 | 互動；可用 CLI 引導 |

## 相關

- [郵件可送達性](../email/deliverability-ZH.md)  
- [CLI 參考 — email](../cli/reference-ZH.md)  
