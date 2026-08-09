# system-ops.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Email/ssl/php apply + nginx site/purge | `routes/system-apply-stack.ts` | **R1** |
| Systemd, services matrix/lifecycle, self-update | `routes/system-apply-services.ts` | **R1** |
| Apply dispatcher | `routes/system-apply.ts` | **R1** |
| Export, managed nginx, rebuild | `routes/system-migrate-export.ts` | **R2** |
| Host migrate jobs + readiness fix | `routes/system-migrate-host.ts` | **R2** |
| Migrate dispatcher | `routes/system-migrate.ts` | **R2** |

`routes/system-ops.ts` thin dispatcher: `apply(stack → services) → migrate(export → host)` (with system/* path gate).
