# Panel 2FA vs SSH 2FA

> Language: English | [中文](./2fa-panel-vs-ssh-ZH.md)

## Summary

| Item | Panel TOTP | SSH TOTP |
|------|------------|----------|
| Purpose | Web / API session login | Linux user SSH login |
| Secret storage | Control-plane store | User home (e.g. google_authenticator) |
| CLI / UI | Security page / API | `ysk-server ssh-2fa …` |

**Secrets are not shared.** Do not reuse one code path for both.

## Panel TOTP

- Enroll under Security → Account  
- Recovery codes shown once  
- Optional `security.require_admin_totp` / strict  

## SSH TOTP

```bash
ysk-server ssh-2fa list --json
ysk-server ssh-2fa enroll --user linuxuser
ysk-server ssh-2fa confirm --user linuxuser --code 123456
ysk-server ssh-2fa install --execute
```

PAM uses nullok where configured; retiring enrollment is explicit.

## Related

[2fa.md](./2fa.md) · [ssh.md](./ssh.md) · [2fa-break-glass.md](./2fa-break-glass.md)
