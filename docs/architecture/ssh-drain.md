# ssh.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| SSH identity vault | `routes/ssh-identities.ts` | **J1** |
| SFTP keys / sshd snippet | `routes/ssh-sftp.ts` | **J2** |
| SSH login 2FA + fail2ban snippets | `routes/ssh-2fa.ts` | **J3** |

`routes/ssh.ts` is a **thin dispatcher**:

```
identities → sftp → 2fa
```

**Wave J complete.**
