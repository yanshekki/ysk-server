# Security overview

> Language: English | [中文](./overview-ZH.md)

YSK Server is a **single-host** control plane. Security is fail-closed for host mutations and honest about what the panel can and cannot do.

## Principles

| Principle | Practice |
|-----------|----------|
| Execute gate | Host changes require `YSK_EXECUTE=1` and usually root |
| Auth | Session cookie/token + optional TOTP step-up; API keys hashed |
| RBAC | Capability checks on mutating routes |
| Sandbox | File ops constrained under public or project roots |
| Audit | Control-plane actions append to audit log |

## Features

- **Panel login / sessions / API keys** — see [security-auth.md](../features/security-auth.md)
- **2FA (panel)** — [2fa.md](./2fa.md) (distinct from SSH 2FA)
- **SSH identities / FIDO2 / SSH 2FA** — [ssh.md](./ssh.md)
- **Host defense (UFW, fail2ban, protection center)** — [defense.md](../features/defense.md)
- **Public file shares** — token URL; optional password (`scrypt` salted; legacy SHA-256 accepted); expiry; auth rate-limited
- **WebDAV** — Basic `ysk` + one-time token; disable revokes access; auth rate-limited

Reviews: [phase-0-review.md](./phase-0-review.md) · [phase-7-review.md](./phase-7-review.md) · [audit-1.0.8.md](./audit-1.0.8.md)

## CLI

```bash
ysk-server security status --json
ysk-server security sessions list --json
ysk-server security api-keys list --json
ysk-server defense status --json
ysk-server ssh-key list --json
ysk-server files webdav status --json
```

## Operator checklist

1. Strong admin password; enable panel TOTP for admins
2. Prefer HTTPS for panel, WebDAV, and public shares
3. Keep `YSK_EXECUTE` off when not applying host changes
4. Review audit and readiness after major changes
5. Rotate WebDAV tokens after staff changes

## Related

- Phase 0 review: [phase-0-review.md](./phase-0-review.md)
- RBAC route audit: [rbac-route-audit.md](./rbac-route-audit.md)
