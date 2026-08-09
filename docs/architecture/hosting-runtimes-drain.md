# hosting-runtimes.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Runtimes core dispatcher | `routes/hosting-runtimes-core.ts` | **N2** / **P1** |
| Tools / list / install / switch | `routes/hosting-runtimes-install.ts` | **P1** |
| Addons / plugins / latest | `routes/hosting-runtimes-plugins.ts` | **P1** |
| PHP extensions/ini + runtime tuning | `routes/hosting-runtimes-php.ts` | **N2** |

`routes/hosting-runtimes.ts` thin dispatcher: `core → php`.  
`routes/hosting-runtimes-core.ts` thin dispatcher: `install → plugins`.
