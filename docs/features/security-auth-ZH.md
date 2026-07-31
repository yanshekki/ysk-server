# 安全與認證

> 語言：中文 | [English](./security-auth.md)

**面板路由：** `/security`  
**CLI：** `security`、`users`、`audit`、`ssh-key`、`ssh-2fa`、`rbac`

## 功能

| 主題 | 能力 |
|------|------|
| 登入 | 工作階段、閒置／絕對時限 |
| 2FA | 面板 TOTP、復原碼、WebAuthn |
| API 金鑰 | `ysk_*`（建立時只顯示一次） |
| 管理員旗標 | require_admin_totp／strict |
| 審計 | 近期操作 |
| SSH | 身分庫 + **獨立** SSH 登入 TOTP |

## CLI

```bash
ysk-server security status --json
ysk-server security sessions list --user admin
ysk-server security sessions revoke --id PREFIX --user admin
ysk-server security api-keys create --name ci --scope read --json
ysk-server users list --q admin
ysk-server audit --limit 50 --q login
ysk-server ssh-2fa list
ysk-server rbac audit
```

## 誠實邊界

SSH 2FA 密鑰 ≠ 面板 TOTP。破門需主機主控台 — 見 [../security/2fa-break-glass-ZH.md](../security/2fa-break-glass-ZH.md)。

## 相關

[../security/overview-ZH.md](../security/overview-ZH.md) · [users-rbac-ZH.md](./users-rbac-ZH.md)
