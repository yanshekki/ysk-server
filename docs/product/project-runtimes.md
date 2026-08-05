# Project × Runtime support matrix

**SSOT kinds：** `node | php | static | python | go | rust | java | kotlin | bun`

| Runtime | Create | Versions | Deploy family | Build / start (default) | Gateway |
|---------|--------|----------|---------------|-------------------------|---------|
| node | ✅ | 18/20/22 | node-process | `node server.js` (+ PM2 option) | Nginx → PORT |
| php | ✅ | 8.1–8.3 | php-fpm | FPM pool + public/ | Nginx → socket |
| static | ✅ | — | static | public/ only | Nginx root |
| python | ✅ | 3.10–3.12 | generic-process | venv + pip; gunicorn/uvicorn/script | Nginx → PORT |
| go | ✅ | 1.21–1.23 | generic-process | `go build -o app` | Nginx → PORT |
| rust | ✅ | stable / 1.78 / 1.81 | generic-process | `cargo build --release` | Nginx → PORT |
| java | ✅ | 17 / 21 | generic-process | Maven/Gradle when present; `java -jar` | Nginx → PORT |
| kotlin | ✅ | 2.1.0 / 2.0.21 | generic-process | Same JVM jar path as Java | Nginx → PORT |
| bun | ✅ | latest / 1.1.38 | node-process | `bun install` + `bun` entry | Nginx → PORT |

## Definition of Done (new runtime)

1. Host install + probe (GenericRuntime / dedicated page)  
2. `ProjectRuntimeKind` in **shared + core**  
3. `defaultProcessCommands` (or dedicated deploy)  
4. Create UI selection + version list  
5. `runtime-ui` profile + i18n names  
6. Tests for commands / version normalize  

## Out of scope

Docker app runtime, .NET, Ruby — no host install surface yet.
