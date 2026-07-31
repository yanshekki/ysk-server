# SSH FIDO2／安全金鑰

> 語言：中文 | [English](./ssh-fido2.md)

## 用途

以 FIDO2／硬體安全金鑰作 SSH 公鑰類型（`sk-…`）。

## 操作

1. 用戶端產生 `sk-ssh-ed25519@openssh.com` 等類型金鑰。  
2. 將公鑰安裝到目標用戶 `authorized_keys`（可用 `ssh-key` 身分庫輔助）。  
3. 需要時配合 `ssh-2fa`（TOTP）作第二因素。  

詳見英文版與 OpenSSH 文件。
