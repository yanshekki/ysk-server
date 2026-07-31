# 2FA 緊急破門（面板／SSH）

> 語言：中文 | [English](./2fa-break-glass.md)

## 用途

管理員遺失驗證器時的緊急存取。需要主機主控台／實體存取。

## 原則

1. 優先使用登記時顯示一次的**復原碼**。  
2. 否則以 root 調整控制平面 TOTP 旗標（高風險）。  
3. 立即重新登記 2FA 並審計。  

## 設定旗標

| 鍵 | 含義 |
|----|------|
| `security.require_admin_totp` | 要求管理員 2FA |
| `security.require_admin_totp_strict` | 嚴格：未開 2FA 拒登入 |

```bash
ysk-server security status --json
```

## 面板操作員遺失驗證器

1. 若有復原碼，於登入時使用。  
2. 有主控台時，停用 strict 旗標或清除該用戶登記（僅限文件化操作）。  
3. 強制改密 + 新 TOTP。  

## SSH 用戶遺失驗證器

```bash
ysk-server ssh-2fa retire --user linuxuser --execute
# 然後重新登記
```

## 加固

破門能力等同主機 root。保護 dataDir 權限與備份。

## 相關

[2fa-ZH.md](./2fa-ZH.md) · [2fa-panel-vs-ssh-ZH.md](./2fa-panel-vs-ssh-ZH.md)
