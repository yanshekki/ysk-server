# Users, packages & RBAC

> Language: English | [中文](./users-rbac-ZH.md)

## Purpose

Control-plane **users**, **packages** (plans), and **RBAC** policy inspection.

**Non-goals:** Full multi-tenant reseller tree (admin-first product).

## Panel

| Item | Value |
|------|--------|
| Route | `/users` |
| Nav key | `users` |
| Main actions | Users CRUD · packages · role matrix |
| Capability | Admin users / packages / rbac |
| RBAC | Admins |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Users list/create | `ysk-server users list\|create …` | write-panel | |
| Packages list | `ysk-server packages list` | read | |
| RBAC list/show/audit | `ysk-server rbac list\|show\|audit` | read | |

## CLI quick start

```bash
ysk-server users list --json
ysk-server packages list --json
ysk-server rbac list --json
```

## Honesty

- Panel packages are control-plane plans, not apt packages (`updates` / `software`).  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| — | None |

## Related

- [Security auth](./security-auth.md)  
