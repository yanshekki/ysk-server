# system-db.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Console / SQL switch / MySQL / MariaDB / Postgres | `routes/system-db-engines.ts` | **N1** |
| Redis service/browser + dump/import | `routes/system-db-redis.ts` | **N1** |

`routes/system-db.ts` thin dispatcher: `engines → redis`.
