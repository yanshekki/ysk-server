# logs.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Overview, sources, journal, query, stream, projects | `routes/logs-read.ts` | **Q3** |
| Export, vacuum, settings, bookmarks, logrotate | `routes/logs-ops.ts` | **Q3** |
| Path-gated dispatcher | `routes/logs.ts` | **Q3** |

Dispatch: `read → ops` (prefix `/api/v1/logs`).

Entry: `controllers/logs-controller.ts` re-exports `handleLogsRoutes`.
