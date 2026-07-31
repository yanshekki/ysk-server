# 面板 2FA 與 SSH 2FA

> 語言：中文 | [English](./2fa-panel-vs-ssh.md)

## 分別

| 項目 | 面板 TOTP | SSH TOTP |
|------|-----------|----------|
| 用途 | 登入 Web／API session | Linux 用戶 SSH 登入 |
| 密鑰 | 存控制平面 store | 用戶 home（如 google_authenticator） |
| CLI | 面板安全頁／API | `ysk-server ssh-2fa …` |

**兩者密鑰不相同**，不要混用。

## 相關

[2fa-ZH.md](./2fa-ZH.md) · [ssh-ZH.md](./ssh-ZH.md) · 英文版細節。
