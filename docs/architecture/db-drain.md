# db.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Adminer / temp-users / remote-hosts | `routes/db-access.ts` | **M1** |
| HA clusters plan/apply/probe/fleet | `routes/db-clusters.ts` | **M1** |

`routes/db.ts` thin dispatcher: `access → clusters`.
