# SSH 身分庫

> 語言：中文 | [English](./ssh-identities.md)

## 用途

控制平面保管／匯出 SSH 身分，供安裝到專案用戶或主機。

## CLI

```bash
ysk-server ssh-key list|create|import|public|export|install|delete …
```

## 誠實邊界

安裝到系統 authorized_keys／sshd 變更需 root + EXECUTE（視路徑而定）。

相關：[ssh-ZH.md](./ssh-ZH.md) · `ssh-2fa`。
