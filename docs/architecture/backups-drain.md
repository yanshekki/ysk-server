# backups.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| List / status / download / delete | `routes/backups-list.ts` | **T2** |
| Control-plane / run-all / restore | `routes/backups-run.ts` | **T2** |
| Core dispatcher | `routes/backups-core.ts` | **T2** |
| Restic run / snapshots / restore | `routes/backups-restic.ts` | **K2** |
| Settings + schedule | `routes/backups-settings.ts` | **K2** |

`routes/backups.ts` thin dispatcher: `core(list → run) → restic → settings`.
