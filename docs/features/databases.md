# Databases

> Language: English | [中文](./databases-ZH.md)

**Panel routes:** `/databases/mysql|mariadb|postgres|redis` (+ service consoles)  
**CLI:** `hosting mysql-provision|postgres-provision|redis-provision`, `db-cluster`

## What it does

| Engine | Capability |
|--------|------------|
| MySQL / MariaDB | Provision plan, users/db rows, service console |
| PostgreSQL | Provision plan, service status |
| Redis | Instance plan, PING when tools allow |
| Cluster | **Plan-first** HA sketches (`db-cluster`) |

## CLI

```bash
ysk-server hosting mysql-provision --json
ysk-server hosting mysql-provision --execute --json
ysk-server hosting postgres-provision --execute --json
ysk-server hosting redis-provision --execute --json
ysk-server db-cluster list --json
ysk-server db-cluster plan --json
```

## Workflow

1. Probe service / client binaries (`services`, readiness).  
2. Run provision **dry-run** JSON.  
3. `--execute` only with EXECUTE (and root when installing packages/units).  
4. Store credentials from result; restrict panel access.

## Honesty

Without EXECUTE, provision refuses live server changes. Cluster modules do not silently form a multi-node cluster.

## Related

[system-host.md](./system-host.md) · [../cli/reference.md](../cli/reference.md)
