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
| Inventory / status | `ysk-server migrate inventory\|status` | read | Inventory includes leftover `/home/ysk-server-<uuid>` with no store row (`orphanHomes`). |
| Host migrate / post / resume | `ysk-server migrate host\|post\|resume` | write-host | needs execute |
| Orphan project homes | `ysk-server migrate orphan-homes [--path … --confirm PATH --execute]` | write-host | List without `--path`. Delete needs matching `--confirm` + `YSK_EXECUTE=1`. Same as `POST /api/v1/system/migrate/orphan-homes`. |

## CLI quick start

```bash
ysk-server migrate inventory --json
ysk-server migrate status --json
```

## Honesty

- Long-running host moves need EXECUTE and careful planning.  
- Never claim complete without post-checks.  
- Orphan `/home/ysk-server-<uuid>` dirs are leftover disk homes, not false positives. Delete is confirm + EXECUTE only.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Wizard progress UX | Same steps via CLI |

## Related

- [Deploy host-migrate](../deploy/host-migrate.md)  
