# projects.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Deploy / lifecycle / os-user / suspend | `routes/projects-lifecycle.ts` | **H1** |
| Network / logs / ftp / php / quota / … | `routes/projects-ops.ts` | **H2** |
| Isolation / list / wizard / create / get / delete / templates | `routes/projects-crud.ts` | **H3** |

`routes/projects.ts` is a **thin dispatcher**:

```
lifecycle → ops → crud
```

**Wave H complete.**
