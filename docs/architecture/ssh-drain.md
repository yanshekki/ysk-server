# ssh.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| SSH identity host ops (install/test/rotate/…) | `routes/ssh-identities-ops.ts` | **S3** |
| SSH identity vault CRUD | `routes/ssh-identities-crud.ts` | **S3** |
| Identities dispatcher | `routes/ssh-identities.ts` | **S3** |
| SFTP keys / sshd snippet | `routes/ssh-sftp.ts` | **J2** |
| SSH 2FA host snippets (PAM / strict / fail2ban) | `routes/ssh-2fa-host.ts` | **W2** |
| SSH 2FA vault enroll lifecycle | `routes/ssh-2fa-vault.ts` | **W2** |
| 2FA dispatcher | `routes/ssh-2fa.ts` | **W2** |

`routes/ssh.ts` is a **thin dispatcher**:

```
identities(ops → crud) → sftp → 2fa(host → vault)
```

**Wave J complete.** Wave S3 further drains identities; Wave W2 further drains 2FA.
