# 2FA 完成清單

> 語言：中文 | [English](./2fa-100-checklist.md)

## 清單

- [ ] 管理員已開啟面板 TOTP
- [ ] 復原碼已離線保存
- [ ] 已覆核可選 `require_admin_totp`／strict
- [ ] 關鍵 Linux 用戶已用 `ssh-2fa` 登記（如需要）
- [ ] 已在主控台演練破門路徑

## CLI

```bash
ysk-server security status --json
ysk-server ssh-2fa list --json
```

## 相關

[2fa-ZH.md](./2fa-ZH.md) · [2fa-break-glass-ZH.md](./2fa-break-glass-ZH.md)
