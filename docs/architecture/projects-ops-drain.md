# projects-ops.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Network / nginx-conf / web-stats | `routes/projects-ops-edge.ts` | **V1** |
| Node/wordpress/git/env/backup/runtime/php | `routes/projects-ops-deploy.ts` | **V1** |
| Runtime dispatcher | `routes/projects-ops-runtime.ts` | **V1** |
| Logs / ftp / quota / php-fpm/ini / usage | `routes/projects-ops-data.ts` | **N3** |

`routes/projects-ops.ts` thin dispatcher: `runtime(edge → deploy) → data`.
