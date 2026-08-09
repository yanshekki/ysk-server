# projects.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Deploy / lifecycle / os-user / suspend | `routes/projects-lifecycle.ts` | **H1** |
| Network / logs / ftp / php / quota / … | (pending in projects.ts) | H2 |
| CRUD / wizard / templates + dispatcher | (pending) | H3 |

`handleProjectsRoutes` calls `handleProjectsLifecycleRoutes` for project-scoped deploy/lifecycle paths.
