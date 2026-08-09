# hosting.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| PM2 + process fleet / SSE | `routes/hosting-processes.ts` | **G1** |
| Runtimes / PHP / addons / plugins / tuning | `routes/hosting-runtimes.ts` | **G2** |
| Nginx / DNS / firewall / files / DB provision | `routes/hosting-infra.ts` | **G3** |

`routes/hosting.ts` is a **thin dispatcher**:

```
processes → runtimes → infra
```

**Wave G complete.**
