# RBAC route audit

> Language: English | [中文](./rbac-route-audit-ZH.md)

## Purpose

Mutating `/api/v1/*` routes map to capabilities. Unmatched routes fail closed.

## Public / skipped prefixes

Login, logout, selected self-service auth, and limited agent poller paths may skip cap checks but still authenticate in handlers.

## CLI

```bash
ysk-server rbac list --json
ysk-server rbac show --role operator --json
ysk-server rbac audit --json
```

## Sample matrix

| Method | Path pattern | Cap (example) |
|--------|--------------|---------------|
| POST/PATCH/DELETE | `/api/v1/users` | `users.manage` |
| POST | `/api/v1/users/:id/impersonate` | `users.impersonate` |
| DELETE | `/api/v1/projects/:id` | project delete cap |
| POST | `/api/v1/tools/execute` | tools execute cap |

Exact rules live in `@yanshekki/shared` `route-capabilities` and server `rbac-guard`.

## Related

[../features/users-rbac.md](../features/users-rbac.md) · [overview.md](./overview.md)
