# 面板 2FA 與 SSH 2FA

> 語言：中文 | [English](./2fa-panel-vs-ssh.md)

## 摘要

| 項目 | 面板 TOTP | SSH TOTP |
|------|-----------|----------|
| 用途 | Web／API 工作階段登入 | Linux 用戶 SSH 登入 |
| 密鑰儲存 | 控制平面 store | 用戶 home（如 google_authenticator） |
| CLI／UI | 帳號安全頁／API | `ysk-server ssh-2fa …` |

**密鑰不相通。** 不要混用同一條路徑。

## 面板 TOTP

- 於帳號安全 → 帳戶登記  
- 復原碼只顯示一次  
- 可選 `security.require_admin_totp`／strict  

## SSH TOTP

```bash
ysk-server ssh-2fa list --json
ysk-server ssh-2fa enroll --user linuxuser
ysk-server ssh-2fa confirm --user linuxuser --code 123456
ysk-server ssh-2fa install --execute
```

PAM 在設定下可用 nullok；撤銷登記須明確操作。

## 相關

[2fa-ZH.md](./2fa-ZH.md) · [ssh-ZH.md](./ssh-ZH.md) · [2fa-break-glass-ZH.md](./2fa-break-glass-ZH.md)
