# files-controller.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

## Moved out

| Domain | Module | Wave |
|--------|--------|------|
| Shared helpers (resolveRoot, rate-limit, chown) | `routes/files-shared.ts` | **E1** |
| WebDAV protocol + public share download | `routes/files-public.ts` | **E1** |

## Still residual in files-controller

- Authenticated CRUD (list/read/write/mkdir/…)
- Trash / shares / favorites / versions
- WebDAV control-plane settings (`/api/v1/files/webdav*`)

## Dispatch note

`handleFilesPublicRoutes` runs **before** `handleFilesRoutes` (WebDAV + public share).
