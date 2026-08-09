# auth.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Login / logout / me / sessions / password / locale / api-keys | `routes/auth-session.ts` | **L3** |
| TOTP / WebAuthn / devices / backup codes | `routes/auth-mfa.ts` | **L3** |

`routes/auth.ts` thin dispatcher: `session → mfa`.
