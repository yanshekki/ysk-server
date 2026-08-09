# hosting.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| PM2 + process fleet / SSE | `routes/hosting-processes.ts` | **G1** |
| Runtimes / PHP / addons / tuning | (pending in hosting.ts) | G2 |
| Nginx / DNS / firewall / files / DB provision | (pending in hosting.ts) | G3 |

`handleHostingRoutes` dispatches processes via `handleHostingProcessesRoutes` first.
