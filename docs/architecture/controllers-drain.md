# Controllers → routes drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

Thin re-exports under `apps/server/src/controllers/*` keep stable `http-server` imports.

| Module | Handler location | Wave |
|--------|------------------|------|
| system-controller | `routes/system-ops.ts` (+ domain slices) | C–D |
| files-controller | `routes/files*.ts` | E |
| logs-controller | `routes/logs.ts` | **F1** |
| metrics-controller | `routes/metrics.ts` | **F2** |
| network-controller | `routes/network.ts` | **F2** |
| resources-controller | `routes/resources.ts` | **F3** |

**Wave F complete** — all modular controllers are thin re-exports into `routes/*`.
