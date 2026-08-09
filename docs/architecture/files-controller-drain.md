# files-controller.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

## Moved out

| Domain | Module | Wave |
|--------|--------|------|
| Shared helpers (resolveRoot, rate-limit, chown) | `routes/files-shared.ts` | **E1** |
| WebDAV protocol + public share download | `routes/files-public.ts` | **E1** |
| Trash / shares / favorites / versions / WebDAV settings | `routes/files-meta.ts` | **E2** |

## Still residual in files-controller

- Authenticated CRUD (list/read/write/mkdir/chmod/zip/…)

## Dispatch note

`handleFilesPublicRoutes` runs **before** `handleFilesRoutes`.  
`handleFilesMetaSection` runs inside `handleFilesRoutes` after auth + root resolve.

