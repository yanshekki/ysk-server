# backups.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| List / status / control-plane / run-all / restore / download | `routes/backups-core.ts` | **K2** |
| Restic run / snapshots / restore | `routes/backups-restic.ts` | **K2** |
| Settings + schedule | `routes/backups-settings.ts` | **K2** |

`routes/backups.ts` thin dispatcher: `core → restic → settings`.
