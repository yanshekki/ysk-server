# projects.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Deploy / lifecycle / os-user / suspend | `routes/projects-lifecycle.ts` | **H1** |
| Network / logs / ftp / php / quota / … | `routes/projects-ops.ts` | **H2** |
| Isolation report / backfill / provision-all | `routes/projects-isolation.ts` | **T3** |
| Wizard / create / delete | `routes/projects-create.ts` | **Z2** |
| List / get / templates | `routes/projects-list.ts` | **Z2** |
| Catalog dispatcher | `routes/projects-catalog.ts` | **Z2** |
| CRUD dispatcher | `routes/projects-crud.ts` | **T3** |

`routes/projects.ts` is a **thin dispatcher**:

```
lifecycle → ops → crud(isolation → catalog(create → list))
```

**Wave H complete.** Wave T3 / Z2 further drain CRUD.
