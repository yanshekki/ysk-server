# SSH identity vault

> Language: English | [中文](./ssh-identities-ZH.md)

## Purpose

Store and install SSH identities for projects and hosts from the control plane.

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

## Honesty

Installing into system `authorized_keys` / sshd paths needs root + EXECUTE where applicable.

Login keys can target an existing Linux user that has no project (home from `getent`). An SSH key test that authenticates then hits nologin is **PASS** (the key works; the shell is locked).

## Related

[ssh.md](./ssh.md) · [ssh-fido2.md](./ssh-fido2.md) · [2fa-panel-vs-ssh.md](./2fa-panel-vs-ssh.md)
