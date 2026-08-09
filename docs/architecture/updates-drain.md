# updates.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Inventory + self status | `routes/updates-inventory.ts` | **K1** |
| Single package apply + SSE | `routes/updates-apply-single.ts` | **Q2** |
| Bulk apply-batch + SSE | `routes/updates-apply-batch.ts` | **Q2** |
| Apply dispatcher | `routes/updates-apply.ts` | **Q2** |
| Scheduler list + dispatcher | `routes/updates.ts` | **K1** |

Dispatch: `inventory → apply(single → batch) → scheduler`.
