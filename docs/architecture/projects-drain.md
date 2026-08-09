# projects.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Deploy / lifecycle / os-user / suspend | `routes/projects-lifecycle.ts` | **H1** |
| Network / logs / ftp / php / quota / … | `routes/projects-ops.ts` | **H2** |
| Isolation report / backfill / provision-all | `routes/projects-isolation.ts` | **T3** |
| List / wizard / create / get / delete / templates | `routes/projects-catalog.ts` | **T3** |
| CRUD dispatcher | `routes/projects-crud.ts` | **T3** |

`routes/projects.ts` is a **thin dispatcher**:

```
lifecycle → ops → crud(isolation → catalog)
```

**Wave H complete.** Wave T3 further drains CRUD.
