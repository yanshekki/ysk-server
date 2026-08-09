# projects-ops.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Network / nginx-conf / web-stats | `routes/projects-ops-edge.ts` | **V1** |
| Node/wordpress/git/env/backup/runtime/php | `routes/projects-ops-deploy.ts` | **V1** |
| Runtime dispatcher | `routes/projects-ops-runtime.ts` | **V1** |
| Project logs / log-dirs | `routes/projects-ops-logs.ts` | **V3** |
| FTP / resources / quota / php-fpm/ini / usage | `routes/projects-ops-quota.ts` | **V3** |
| Data dispatcher | `routes/projects-ops-data.ts` | **V3** |

`routes/projects-ops.ts` thin dispatcher: `runtime(edge → deploy) → data(logs → quota)`.
