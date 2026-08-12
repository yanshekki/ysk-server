# Nginx sites

> Language: English | [中文](./nginx-sites-ZH.md)

## Purpose

Nginx as the **default edge** for projects: status probe, managed conf inventory, config test, and sync to system conf.d.

**Non-goals:** Full visual site builder; Apache dual-publish from project pages.

## Panel

| Item | Value |
|------|--------|
| Route | `/nginx` |
| Nav key | `nginx` |
| Main actions | Status · conf list · test · sync |
| Capability | Nginx |
| RBAC | Hosting operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Status / overview | `ysk-server nginx status --json` | read | includes nginx -t when bin present |
| List managed confs | `ysk-server nginx list --json` | read | |
| Config test | `ysk-server nginx test --json` | read | |
| Sync to host | `ysk-server nginx sync --execute --json` | write-host | |

## CLI quick start

```bash
ysk-server nginx status --json
ysk-server nginx list --json
export YSK_EXECUTE=1
ysk-server nginx sync --execute --json
```

## Honesty

- Sync dry-run until `--execute`.  
- `nginx -t` failure blocks honest “applied”.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| — | None |

## Related

- [DNS / SSL / Nginx](./dns-ssl-nginx.md) · [Projects](./projects.md)  
