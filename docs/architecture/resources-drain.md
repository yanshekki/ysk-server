# resources.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Shared helpers (redact, FTP normalize, collection parse) | `routes/resources-shared.ts` | **S1** |
| List / get | `routes/resources-read.ts` | **U1** |
| Create | `routes/resources-create.ts` | **Z3** |
| Patch / delete | `routes/resources-mutate.ts` | **Z3** |
| Write dispatcher | `routes/resources-write.ts` | **Z3** |
| CRUD dispatcher | `routes/resources-crud.ts` | **U1** |
| Collection apply actions | `routes/resources-apply.ts` | **S1** |
| Path-gated dispatcher | `routes/resources.ts` | **S1** |

Dispatch: `auth + parse → crud(read → write(create → mutate)) → apply` (prefix `/api/v1/resources`).

Entry: `controllers/resources-controller.ts` re-exports `handleResourcesRoutes`.
