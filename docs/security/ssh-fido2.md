# SSH FIDO2 / security keys

> Language: English | [中文](./ssh-fido2-ZH.md)

## Purpose

Use FIDO2 / hardware security keys as OpenSSH public key types (`sk-…`).

## Operator steps

1. Generate a key of type `sk-ssh-ed25519@openssh.com` or `sk-ecdsa-sha2-nistp256@openssh.com` on the client.  
2. Touch the key when prompted.  
3. Install the public key into the target user `authorized_keys` (panel SSH identity vault can help).  
4. Optionally combine with `ssh-2fa` TOTP as a second factor.

## CLI helpers

```bash
ysk-server ssh-key list --json
ysk-server ssh-key import --name yubikey --file ./id_ed25519_sk.pub
ysk-server ssh-key install --id KEY --user linuxuser --execute
```

## Related

[ssh-identities.md](./ssh-identities.md) · [ssh.md](./ssh.md)
