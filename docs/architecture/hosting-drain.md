# hosting.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| PM2 + process fleet / SSE | `routes/hosting-processes.ts` | **G1** |
| Runtimes / PHP / addons / plugins / tuning | `routes/hosting-runtimes.ts` | **G2** |
| Nginx / DNS / firewall / files / DB provision | `routes/hosting.ts` (residual infra) | G3 target |

`handleHostingRoutes` dispatches processes → runtimes → infra handlers in order.
