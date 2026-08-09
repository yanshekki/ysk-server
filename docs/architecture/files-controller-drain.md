# files-controller.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

## Moved out

| Domain | Module | Wave |
|--------|--------|------|
| Shared helpers (resolveRoot, rate-limit, chown) | `routes/files-shared.ts` | **E1** |
| WebDAV protocol + public share download | `routes/files-public.ts` | **E1** |
| Trash / shares / favorites / versions / WebDAV settings | `routes/files-meta.ts` | **E2** |
| Authenticated file CRUD | `routes/files.ts` | **E3** |

## Residual

`controllers/files-controller.ts` is a **thin re-export**:

```ts
export { handleFilesRoutes } from '../routes/files.js';
```

Stable import path for `http-server.ts` kept.

## Dispatch note

1. `handleFilesPublicRoutes` (WebDAV + public share)  
2. `handleFilesRoutes` → CRUD + `handleFilesMetaSection` after auth/root  
