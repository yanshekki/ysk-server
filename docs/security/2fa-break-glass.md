# 2FA break-glass (panel / SSH)

> Language: English | [中文](./2fa-break-glass-ZH.md)

## Purpose

Emergency access when an admin loses their authenticator. Requires host console / physical access.

## Principles

1. Prefer **recovery codes** shown once at enrollment.  
2. Otherwise adjust control-plane TOTP flags as root (high risk).  
3. Re-enroll 2FA immediately and audit.

## Settings flags

| Key | Meaning |
|-----|---------|
| `security.require_admin_totp` | Require admin 2FA |
| `security.require_admin_totp_strict` | Strict: block admin login without 2FA |

```bash
ysk-server security status --json
```

## Panel operator lost authenticator

1. Use a recovery code at login if available.  
2. With console access, disable strict flags or clear enrollment for that user in the store (documented ops only).  
3. Force password change + new TOTP.

## SSH user lost authenticator

```bash
ysk-server ssh-2fa retire --user linuxuser --execute
# then re-enroll
```

## Hardening

Break-glass capability equals host root. Protect dataDir permissions and backups.

## Related

[2fa.md](./2fa.md) · [2fa-panel-vs-ssh.md](./2fa-panel-vs-ssh.md)
