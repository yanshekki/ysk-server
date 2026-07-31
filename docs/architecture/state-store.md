# Control-plane state store

> Language: English | [中文](./state-store-ZH.md)

Control-plane state (users, projects, settings, sessions, api_keys, …) is a **document store**: one snapshot blob, not a full relational schema per table.

## Backends

| Kind | When | Notes |
|------|------|-------|
| **json** | Default | `dataDir/ysk.json`, atomic rename |
| **sqlite** | `YSK_STORE=sqlite` or path ends `.sqlite` | sql.js child process; JSON mirror |
| **postgres** | `YSK_STORE=postgres` + URL | Experimental document blob; needs `pg` |

## CLI

```bash
ysk-server store status --json
ysk-server store export --out snapshot.json
ysk-server store import --in snapshot.json
ysk-server store migrate --to sqlite --out /var/lib/ysk/ysk.sqlite
```

## Honesty

- Document mode ≠ ORM / per-table SQL.  
- Multi-writer JSON/SQLite is unsafe; use single writer.  
- Prefer `store export` before migrate.  

Full ops notes: [../deploy/](../deploy/) and historical [../deploy/state-store.md](../deploy/state-store.md) if present under archive after D6.
