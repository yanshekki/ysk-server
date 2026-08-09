# system-ops.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Email/ssl/php apply + nginx site/purge | `routes/system-apply-stack.ts` | **R1** |
| Systemd, services matrix/lifecycle, self-update | `routes/system-apply-services.ts` | **R1** |
| Apply dispatcher | `routes/system-apply.ts` | **R1** |
| Export, rebuild, migrate, readiness | `routes/system-migrate.ts` | **L1** |

`routes/system-ops.ts` thin dispatcher: `apply(stack → services) → migrate` (with system/* path gate).
