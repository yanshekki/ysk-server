# SSH FIDO2／安全金鑰

> 語言：中文 | [English](./ssh-fido2.md)

## 用途

以 FIDO2／硬體安全金鑰作為 OpenSSH 公鑰類型（`sk-…`）。

## 操作步驟

1. 在用戶端產生 `sk-ssh-ed25519@openssh.com` 或 `sk-ecdsa-sha2-nistp256@openssh.com` 類型金鑰。  
2. 提示時觸摸金鑰。  
3. 將公鑰安裝到目標用戶 `authorized_keys`（面板 SSH 身分庫可輔助）。  
4. 可選配合 `ssh-2fa` TOTP 作第二因素。  

## CLI 輔助

```bash
ysk-server ssh-key list --json
ysk-server ssh-key import --name yubikey --file ./id_ed25519_sk.pub
ysk-server ssh-key install --id KEY --user linuxuser --execute
```

## 相關

[ssh-identities-ZH.md](./ssh-identities-ZH.md) · [ssh-ZH.md](./ssh-ZH.md)
