# 2FA completion checklist

> Language: English | [中文](./2fa-100-checklist-ZH.md)

## Checklist

- [ ] Admin has panel TOTP enabled
- [ ] Recovery codes stored offline
- [ ] Optional `require_admin_totp` / strict reviewed
- [ ] Critical Linux users enrolled via `ssh-2fa` (if required)
- [ ] Break-glass path rehearsed on console

## CLI

```bash
ysk-server security status --json
ysk-server ssh-2fa list --json
```

## Related

[2fa.md](./2fa.md) · [2fa-break-glass.md](./2fa-break-glass.md)
