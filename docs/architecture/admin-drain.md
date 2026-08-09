# admin.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Users list | `routes/admin-users-list.ts` | **AA2** |
| Users create/patch/delete/impersonate/security | `routes/admin-users-ops.ts` | **AA2** |
| Users dispatcher | `routes/admin-users.ts` | **AA2** |
| Packages CRUD | `routes/admin-packages.ts` | **L2** |

`routes/admin.ts` thin dispatcher: `users(list → ops) → packages`.
