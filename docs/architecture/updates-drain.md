# updates.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Inventory + self status | `routes/updates-inventory.ts` | **K1** |
| Package apply + apply-batch | `routes/updates-apply.ts` | **K1** |
| Scheduler list + dispatcher | `routes/updates.ts` | **K1** |

Dispatch: `inventory → apply → scheduler`.
