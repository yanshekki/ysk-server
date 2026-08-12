# Host migrate

> Language: English | [中文](./migrate-ZH.md)

## Purpose

**Whole-host migration** inventory, transfer, post-steps, and resume helpers.

**Non-goals:** Zero-downtime multi-DC live migration product.

## Panel

| Item | Value |
|------|--------|
| Route | `/migrate` |
| Nav key | `migrate` |
| Main actions | Inventory · host migrate · post · status · resume |
| Capability | Migrate |
| RBAC | Admins |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Inventory / status | `ysk-server migrate inventory\|status` | read | |
| Host migrate / post / resume | `ysk-server migrate host\|post\|resume` | write-host | needs execute |

## CLI quick start

```bash
ysk-server migrate inventory --json
ysk-server migrate status --json
```

## Honesty

- Long-running host moves need EXECUTE and careful planning.  
- Never claim complete without post-checks.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Wizard progress UX | Same steps via CLI |

## Related

- [Deploy host-migrate](../deploy/host-migrate.md)  
