# db.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Adminer / temp-users / remote-hosts | `routes/db-access.ts` | **M1** |
| Clusters dispatcher | `routes/db-clusters.ts` | **M1** / **Q1** |
| Clusters list/create/get/patch/delete | `routes/db-clusters-crud.ts` | **Q1** |
| Clusters plan/apply/probe/install-peers | `routes/db-clusters-lifecycle.ts` | **Y1** |
| Clusters artifacts/bundle/push/fleet | `routes/db-clusters-fleet.ts` | **Y1** |
| Actions dispatcher | `routes/db-clusters-actions.ts` | **Y1** |

`routes/db.ts` thin dispatcher: `access → clusters`.  
`routes/db-clusters.ts` thin dispatcher: `crud → actions(lifecycle → fleet)`.
