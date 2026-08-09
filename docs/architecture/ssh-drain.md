# ssh.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| SSH identity host ops (install/test/rotate/…) | `routes/ssh-identities-ops.ts` | **S3** |
| SSH identity vault CRUD | `routes/ssh-identities-crud.ts` | **S3** |
| Identities dispatcher | `routes/ssh-identities.ts` | **S3** |
| SFTP keys / sshd snippet | `routes/ssh-sftp.ts` | **J2** |
| SSH login 2FA + fail2ban snippets | `routes/ssh-2fa.ts` | **J3** |

`routes/ssh.ts` is a **thin dispatcher**:

```
identities(ops → crud) → sftp → 2fa
```

**Wave J complete.** Wave S3 further drains identities.
