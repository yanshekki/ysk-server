# system-ops.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Email/ssl/php apply, nginx, systemd, services, self-update | `routes/system-apply.ts` | **L1** |
| Export, rebuild, migrate, readiness | `routes/system-migrate.ts` | **L1** |

`routes/system-ops.ts` thin dispatcher: `apply → migrate` (with system/* path gate).
