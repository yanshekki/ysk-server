# Controllers → routes drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

Thin re-exports under `apps/server/src/controllers/*` keep stable `http-server` imports.

| Module | Handler location | Wave |
|--------|------------------|------|
| system-controller | `routes/system-ops.ts` (+ domain slices) | C–D |
| files-controller | `routes/files*.ts` | E |
| logs-controller | `routes/logs.ts` | **F1** |
| metrics-controller | (pending) | F2 |
| network-controller | (pending) | F2 |
| resources-controller | (pending) | F3 |
