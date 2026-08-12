# Apache

> Language: English | [中文](./apache-ZH.md)

## Purpose

Manage **Apache** virtual hosts and global settings at `/apache` (single entry). Project pages do not publish Apache.

**Non-goals:** Replacing Nginx as the default project edge; dual SSOT for the same site.

## Panel

| Item | Value |
|------|--------|
| Route | `/apache` |
| Nav key | `apache` |
| Main actions | Sites list · create · apply · settings · cleanup conflicts · artifact remove |
| Capability | Hosting / Apache |
| RBAC | Hosting operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| List sites (merged) | `ysk-server apache sites list --json` | read | filter `--source` / `--q` |
| Create standalone site | `ysk-server apache sites create --server-name … --json` | write-panel | |
| Update site | `ysk-server apache sites update --id … --json` | write-panel | not project/artifact ids |
| Delete site | `ysk-server apache sites delete --id …` | write-panel | artifacts need execute |
| Apply site to host | `ysk-server apache sites apply --id … --execute --json` | write-host | |
| Show conf | `ysk-server apache sites conf --id … --json` | read | |
| Cleanup ServerName conflicts | `ysk-server apache sites cleanup-conflicts --execute` | write-host | |
| Settings get/set | `ysk-server apache settings get\|set …` | write-panel | |
| Settings apply | `ysk-server apache settings apply --execute` | write-host | may sync exposure |

## CLI quick start

```bash
ysk-server apache sites list --json
ysk-server apache sites create --server-name app.example.com --kind proxy --upstream 127.0.0.1:3000 --json
export YSK_EXECUTE=1
ysk-server apache sites apply --id SITE_ID --execute --json
ysk-server apache settings get --json
```

Full argv: [../cli/reference.md](../cli/reference.md#apache).

## Authority model

| Source | Authority | Sync to system |
|--------|-----------|----------------|
| Project (PHP) | Project domain + `ysk-{linuxUser}.conf` | Yes (owned) |
| Standalone | `sites.json` | Yes (owned) |
| Disk artifact | Discovery only | **No** (not a second SSOT) |

## Honesty

- Apply needs EXECUTE + root for configtest/reload.  
- **written** conf in dataDir ≠ live Apache until apply succeeds.  
- Artifact rows are residual discovery; remove with care.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| — | None required |

## Related

- [Nginx sites](./nginx-sites.md) — default project edge  
- [Panel ↔ CLI matrix](../cli/panel-parity-matrix.md)  
- [CLI reference — apache](../cli/reference.md#apache)  
