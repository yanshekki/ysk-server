# resources.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Shared helpers (redact, FTP normalize, collection parse) | `routes/resources-shared.ts` | **S1** |
| List / get / create / patch / delete | `routes/resources-crud.ts` | **S1** |
| Collection apply actions | `routes/resources-apply.ts` | **S1** |
| Path-gated dispatcher | `routes/resources.ts` | **S1** |

Dispatch: `auth + parse → crud → apply` (prefix `/api/v1/resources`).

Entry: `controllers/resources-controller.ts` re-exports `handleResourcesRoutes`.
