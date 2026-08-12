# Security & authentication

> Language: English | [中文](./security-auth-ZH.md)

## Purpose

Panel **login security**: sessions, API keys, panel 2FA, audit trail; separate from **SSH** identity and SSH 2FA.

**Non-goals:** Replacing OS PAM entirely outside managed helpers.

## Panel

| Item | Value |
|------|--------|
| Route | `/security` |
| Nav key | `security` |
| Main actions | Status · sessions · API keys · 2FA · audit |
| Capability | Security |
| RBAC | Admins |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Security status | `ysk-server security status --json` | read | |
| Sessions | `ysk-server security sessions list\|revoke…` | write-panel | |
| API keys | `ysk-server security api-keys …` | write-panel | token once |
| Audit | `ysk-server audit --json` | read | |
| SSH keys | `ysk-server ssh-key …` | write-host | install needs execute |
| SSH 2FA | `ysk-server ssh-2fa …` | write-host | ≠ panel TOTP |

## CLI quick start

```bash
ysk-server security status --json
ysk-server security sessions list --json
ysk-server ssh-key list --json
ysk-server audit --limit 50 --json
```

## Honesty

- SSH TOTP ≠ panel TOTP.  
- Host install paths need EXECUTE + root.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| TOTP QR enrollment UI | Interactive; confirm via CLI where exposed |

## Related

- [Users & RBAC](./users-rbac.md) · [Security overview](../security/overview.md)  
