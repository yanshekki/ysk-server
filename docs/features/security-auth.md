# Security & authentication

> Language: English | [中文](./security-auth-ZH.md)

**Panel route:** `/security`  
**CLI:** `security`, `users`, `audit`, `ssh-key`, `ssh-2fa`, `rbac`

## What it does

| Topic | Capability |
|-------|------------|
| Login | Sessions, idle/absolute limits |
| 2FA | Panel TOTP, recovery codes, WebAuthn paths |
| API keys | `ysk_*` tokens (shown once) |
| Admin flags | require_admin_totp / strict |
| Audit | Recent operator actions |
| SSH | Identity vault + **separate** SSH login TOTP |

## CLI

```bash
ysk-server security status --json
ysk-server security sessions list --user admin
ysk-server security sessions revoke --id PREFIX --user admin
ysk-server security api-keys create --name ci --scope read --json
ysk-server users list --q admin
ysk-server audit --limit 50 --q login
ysk-server ssh-2fa list
ysk-server rbac audit
```

## Honesty

SSH 2FA secrets ≠ panel TOTP. Break-glass needs host console access — see [../security/2fa-break-glass.md](../security/2fa-break-glass.md).

## Related

[../security/overview.md](../security/overview.md) · [users-rbac.md](./users-rbac.md)
