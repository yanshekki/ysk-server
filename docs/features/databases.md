# Databases

> Language: English | [中文](./databases-ZH.md)

## Purpose

Operate **MySQL / MariaDB / PostgreSQL / Redis** as services and data planes on the control-plane host: install, lifecycle, console settings, exclusive SQL engine switch, Redis key browser, and optional HA cluster planning.

**Non-goals:** Managed cloud DBaaS; silent multi-node cluster formation without plan/apply.

## Panel

| Item | Value |
|------|--------|
| Routes | `/databases/mysql`, `/mariadb`, `/postgres`, `/redis` (+ service consoles) |
| Nav keys | `mysql`, `mariadb`, `postgres`, `redis` (+ service variants) |
| Main actions | Status · install · start/stop · console apply · SQL switch · Redis keys · clusters |
| Capability | DB / hosting service capabilities |
| RBAC | Operators with database service rights |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Engine / console status | `ysk-server db status [--engine …] --json` | read | |
| Service console get | `ysk-server db console --engine … --json` | read | |
| Console settings apply | `ysk-server db apply --engine … --set k=v --execute` | write-host | |
| Lifecycle start/stop/… | `ysk-server db lifecycle --engine … --action start --execute` | write-host | |
| Install engine packages | `ysk-server db install --engine … --execute` | write-host | |
| SQL engine switch preview | `ysk-server db sql-engine preview --target mariadb --json` | read | MySQL XOR MariaDB |
| SQL engine switch | `ysk-server db sql-engine switch --target … --confirm … --acknowledge-exclusive --execute` | write-host | destructive exclusive |
| Redis service status | `ysk-server redis status --json` | read | |
| Redis settings | `ysk-server redis settings get\|set\|apply` | write-panel / write-host | |
| Redis keys list/get | `ysk-server redis keys\|get …` | read | |
| Redis set/del | `ysk-server redis set\|del … --execute` | write-host | |
| Provision plans | `ysk-server hosting mysql-provision\|postgres-provision\|redis-provision` | write-host | dry-run default |
| DB cluster fleet | `ysk-server db-cluster list\|plan\|apply …` | write-host | plan-first HA. `create --kind postgres-…` infers `--engine postgres`. Wizard can paste a `/agents` fleet session (non-SSH). Redis peer README is Redis, not Galera. |
| Remote DB hosts | `POST /api/v1/db/remote-hosts/:id/test` | read | TCP reachability. Panel: Test connection. |

## CLI quick start

```bash
ysk-server db status --json
ysk-server db console --engine mysql --json
ysk-server redis keys --pattern '*' --json
ysk-server db sql-engine preview --target mariadb --json
export YSK_EXECUTE=1
ysk-server db lifecycle --engine redis --action start --execute --json
ysk-server hosting mysql-provision --execute --json
```

Full argv: [../cli/reference.md](../cli/reference.md#db--redis--db-cluster).

## Honesty

- Without EXECUTE, install/lifecycle/apply stay blocked or dry-run.  
- SQL switch is **exclusive** (MySQL XOR MariaDB); always preview + confirm phrase.  
- Cluster modules never silently form multi-node clusters.  
- Postgres cluster probe runs as the `postgres` OS user (`runuser -u postgres -- psql`).  
- Dry-run cluster push notes are not shown as “system change is off”.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Rich console form widgets | Same settings available via `db apply --set` |

## Related

- [Panel ↔ CLI matrix](../cli/panel-parity-matrix.md)  
- [System & host](./system-host.md)  
- [CLI reference](../cli/reference.md)  
