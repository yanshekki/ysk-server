# Project isolation

> Language: English | [中文](./isolation-ZH.md)

## Goal

Dedicated Linux user + home per project for least privilege.

```bash
ysk-server projects isolation list --json
ysk-server projects isolation provision --id UUID --execute
ysk-server projects isolation provision-all --execute
ysk-server projects isolation backfill-owners --json
```

## Honesty

`useradd` needs root+EXECUTE. Without provision, degraded homes under dataDir may still run apps.

## Related

[../features/projects.md](../features/projects.md) · [project-isolation.md](./project-isolation.md)
