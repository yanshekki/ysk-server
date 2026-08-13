# 安全概覽

> 語言：中文 | [English](./overview.md)

YSK Server 是**單機**控制平面。安全模型對主機變更 **fail-closed**，並誠實標示面板能做／不能做的事。

## 原則

| 原則 | 做法 |
|------|------|
| 執行閘 | 改主機需 `YSK_EXECUTE=1`，通常還要 root |
| 認證 | 工作階段／token + 可選 TOTP 提權；API 金鑰雜湊存放 |
| RBAC | 變更路由檢查 capability |
| 沙箱 | 檔案操作限於公用或專案根 |
| 審計 | 控制面操作寫入 audit |

## 功能

- **面板登入／工作階段／API 金鑰** — 見 [security-auth-ZH.md](../features/security-auth-ZH.md)
- **面板 2FA** — [2fa-ZH.md](./2fa-ZH.md)（與 SSH 2FA 分開）
- **SSH 身分／FIDO2／SSH 2FA** — [ssh-ZH.md](./ssh-ZH.md)
- **主機防護（UFW、fail2ban、防護中心）** — [defense-ZH.md](../features/defense-ZH.md)
- **公開檔案分享** — token 連結；可選密碼（`scrypt` 加鹽；舊 SHA-256 仍可驗證）；可到期；認證限流
- **WebDAV** — Basic `ysk` + 一次性權杖；停用即撤銷；認證限流

覆核：[phase-0-review-ZH.md](./phase-0-review-ZH.md) · [phase-7-review-ZH.md](./phase-7-review-ZH.md) · [audit-1.0.8-ZH.md](./audit-1.0.8-ZH.md)

## CLI

```bash
ysk-server security status --json
ysk-server security sessions list --json
ysk-server security api-keys list --json
ysk-server defense status --json
ysk-server ssh-key list --json
ysk-server files webdav status --json
```

## 操作員清單

1. 強管理員密碼；管理員開面板 TOTP
2. 面板、WebDAV、公開分享優先 HTTPS
3. 非套用變更時關閉 `YSK_EXECUTE`
4. 重大變更後檢查 audit 與就緒
5. 人員異動後輪換 WebDAV 權杖

## 相關

- Phase 0 審查：[phase-0-review-ZH.md](./phase-0-review-ZH.md)
- RBAC 路由審計：[rbac-route-audit-ZH.md](./rbac-route-audit-ZH.md)
