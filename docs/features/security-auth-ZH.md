# 安全與認證

> 語言：中文（香港書面語）| [English](./security-auth.md)

## 用途

面板 **登入安全**：工作階段、API 金鑰、面板 2FA、審計軌跡；與 **SSH** 身分及 SSH 2FA 分離。

**非目標：** 在受管輔助之外完全取代 OS PAM。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/security` |
| 導航鍵 | `security` |
| 主要操作 | 狀態 · 工作階段 · API 金鑰 · 2FA · 審計 |
| 能力 | 安全 |
| RBAC | 管理員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 安全狀態 | `ysk-server security status --json` | read | |
| 工作階段 | `ysk-server security sessions list\|revoke…` | write-panel | |
| API 金鑰 | `ysk-server security api-keys …` | write-panel | token 僅一次 |
| 審計 | `ysk-server audit --json` | read | |
| SSH 金鑰 | `ysk-server ssh-key …` | write-host | install 需 execute。登入 `authorized_keys` 可指定沒有專案的既有 Linux 用戶。金鑰測試在公鑰通過後遇到 nologin 視為 PASS。 |
| SSH 2FA | `ysk-server ssh-2fa …` | write-host | ≠ 面板 TOTP |
| 面板用戶 2FA 政策 | `ysk-server security status` · `/security` | write-panel | `requireUserTotp` |
| 用戶 2FA 狀態／清除 | `ysk-server users totp\|totp-clear` | write-panel | |

## CLI 速查

```bash
ysk-server security status --json
ysk-server security sessions list --json
ysk-server ssh-key list --json
ysk-server audit --limit 50 --json
```

## 誠實邊界

- SSH TOTP ≠ 面板 TOTP。  
- 主機安裝路徑需 EXECUTE + root。  
- 若帳戶有 `mustChangePassword`，登入後會出現改密表單（`POST /api/v1/auth/password`），改完才可進儀表板。弱的 bootstrap 密碼會被拒絕，除非 `YSK_ALLOW_INSECURE_DEFAULTS=1`。  
- 本帳號未登記 2FA 時，儲存 2FA 政策不需 TOTP。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| TOTP QR 註冊 UI | 互動；可用 CLI 確認（若已暴露） |

## 相關

- [用戶與 RBAC](./users-rbac-ZH.md) · [安全總覽](../security/overview-ZH.md)  
