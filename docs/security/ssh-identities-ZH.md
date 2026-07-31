# SSH 身分庫

> 語言：中文 | [English](./ssh-identities.md)

## 用途

由控制平面保管並安裝 SSH 身分，供專案與主機使用。

## CLI

```bash
ysk-server ssh-key list --json
ysk-server ssh-key create --name deploy
ysk-server ssh-key import --name existing --file ./id_ed25519
ysk-server ssh-key public --id KEY
ysk-server ssh-key export --id KEY
ysk-server ssh-key install --id KEY --user linuxuser --execute
ysk-server ssh-key delete --id KEY
```

## 誠實邊界

安裝到系統 `authorized_keys`／sshd 路徑時，視情況需 root + EXECUTE。

## 相關

[ssh-ZH.md](./ssh-ZH.md) · [ssh-fido2-ZH.md](./ssh-fido2-ZH.md) · [2fa-panel-vs-ssh-ZH.md](./2fa-panel-vs-ssh-ZH.md)
