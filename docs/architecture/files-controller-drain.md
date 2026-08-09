# files-controller.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

## Moved out

| Domain | Module | Wave |
|--------|--------|------|
| Shared helpers (resolveRoot, rate-limit, chown) | `routes/files-shared.ts` | **E1** |
| WebDAV protocol + public share download | `routes/files-public.ts` | **E1** |
| Trash / shares / favorites / versions / WebDAV settings | `routes/files-meta.ts` | **E2** |
| Authenticated list/read/download/stat | `routes/files-read.ts` | **T1** |
| Authenticated write/mutate (upload/mkdir/zip/…) | `routes/files-write.ts` | **T1** |
| Auth + root dispatcher | `routes/files.ts` | **T1** |

## Residual

`controllers/files-controller.ts` is a **thin re-export**:

```ts
export { handleFilesRoutes } from '../routes/files.js';
```

Stable import path for `http-server.ts` kept.

## Dispatch note

1. `handleFilesPublicRoutes` (WebDAV + public share)  
2. `handleFilesRoutes` → auth+root → read → write → `handleFilesMetaSection`  

