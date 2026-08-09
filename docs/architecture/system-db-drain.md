# system-db.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Console / lifecycle / multi-engine install / SQL switch | `routes/system-db-console.ts` | **U3** |
| MySQL / MariaDB / Postgres status & settings ops | `routes/system-db-sql.ts` | **U3** |
| Engines dispatcher | `routes/system-db-engines.ts` | **U3** |
| Redis service + key browser | `routes/system-redis.ts` | **AA3** |
| SQL dump / list / import | `routes/system-db-dump.ts` | **AA3** |
| Redis+dump dispatcher | `routes/system-db-redis.ts` | **AA3** |

`routes/system-db.ts` thin dispatcher: `engines(console → sql) → redis(redis → dump)`.
