# projects.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Deploy / lifecycle / os-user / suspend | `routes/projects-lifecycle.ts` | **H1** |
| Network / logs / ftp / php / quota / … | `routes/projects-ops.ts` | **H2** |
| CRUD / wizard / templates + dispatcher | (pending in projects.ts) | H3 |

Dispatch inside `handleProjectsRoutes`: lifecycle → ops → CRUD/get/delete/templates.
