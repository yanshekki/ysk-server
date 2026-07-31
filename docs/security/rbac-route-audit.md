# RBAC mutating route audit (B1)

> Language: English | [中文](./rbac-route-audit-ZH.md)

**Date:** 2026-07-31  
**Mechanism:** `enforceMutatingRouteCaps` in HTTP pipeline + `MUTATING_ROUTE_CAP_RULES` in `@ysk/shared`.

## Policy

| Mode | Behaviour |
|------|-----------|
| Listed rule | First match wins → `requireCap` |
| Unlisted mutating `/api/v1/*` | **Fail-closed** → `settings.system` (B1) |
| Public / self-service | Skipped (login, logout, totp, sessions, webauthn, agent register, SSO consume) |

## Verify

```bash
ysk-server rbac audit --json
pnpm --filter @ysk/shared test -- src/route-capabilities.test.ts
```

## Critical mappings (sample)

| Method | Path | Cap |
|--------|------|-----|
| POST | `/users` | `users.manage` |
| POST | `/users/:id/impersonate` | `users.impersonate` |
| DELETE | `/projects/:id` | `projects.delete` |
| POST | `/projects/:id/publish-nginx` | `publish.apply` |
| POST | `/backups/restore` | `backups.restore` |
| POST | `/defense/*` | `firewall.edit` |
| POST | `/tools/execute` | `services.control` |
| POST | `/db/*` | `db.write` |
| POST | `/future-unknown` | `settings.system` (fallback) |

## SPA path guards

`PATH_CAP_GUARDS` / `FEATURE_NAV_CAPS` cover users, backups, updates, protection, agents, cdn, migrate, etc.

## Residual risk

- Handlers that only check `roles.includes('admin')` should migrate to `requireCap` (host power done in B1).
- Tool-executor still has finer allowlist beyond route cap.
- New mutating routes should add a **specific** rule above the fail-closed fallback.
