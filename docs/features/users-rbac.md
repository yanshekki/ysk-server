# Users, packages, RBAC

> Language: English | [中文](./users-rbac-ZH.md)

**Panel route:** `/users`  
**CLI:** `users`, `packages`, `rbac`

## Users & packages

| Concept | Meaning |
|---------|---------|
| Users | Panel operators (admin / operator / viewer / …) |
| Packages | Quota templates (often **host-scoped** totals) |
| Overrides | Per-user capability grants/revokes |

```bash
ysk-server users list --role admin --json
ysk-server users create --username ops --password '…' --role operator --json
ysk-server packages list --json
```

## RBAC

Role factory policies + effective capabilities. Mutating API routes map to capabilities (fail-closed).

```bash
ysk-server rbac list --json
ysk-server rbac show --role operator --json
ysk-server rbac audit --json
```

## Honesty

Admin system role cannot be stripped of critical privileges by dirty policy. Package quotas are not full multi-tenant isolation.

## Related

[security-auth.md](./security-auth.md) · [../security/rbac-route-audit.md](../security/rbac-route-audit.md)
