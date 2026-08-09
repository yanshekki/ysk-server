# system-ops.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Email + SSL/LE certificates | `routes/system-apply-tls.ts` | **Y3** |
| PHP + nginx site/purge | `routes/system-apply-web.ts` | **Y3** |
| Stack dispatcher | `routes/system-apply-stack.ts` | **Y3** |
| Systemd, services matrix/lifecycle, self-update | `routes/system-apply-services.ts` | **R1** |
| Apply dispatcher | `routes/system-apply.ts` | **R1** |
| Export, managed nginx, rebuild | `routes/system-migrate-export.ts` | **R2** |
| Host migrate inventory / jobs / post | `routes/system-migrate-jobs.ts` | **X1** |
| Readiness fix actions | `routes/system-readiness.ts` | **X1** |
| Host migrate dispatcher | `routes/system-migrate-host.ts` | **X1** |
| Migrate dispatcher | `routes/system-migrate.ts` | **R2** |

`routes/system-ops.ts` thin dispatcher: `apply(stack → services) → migrate(export → host(jobs → readiness))` (with system/* path gate).
