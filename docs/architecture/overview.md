# YSK Server Architecture

## Layers

| Layer | Responsibility |
|-------|----------------|
| `interfaces` / `types` / `dto` | Contracts shared by API, CLI, Web |
| `entities` / `repositories` | Domain model & persistence adapters |
| `services` | Business logic (auth, protection, orchestration) |
| `security` | Allowlist, Approval, RBAC, Sandbox, tool executor |
| `hosting` | Project isolation, runtimes, DB, Nginx/SSL, file/FTPS/DNS/firewall |
| `llm` | OpenAI-compatible gateway (outputs always untrusted) |
| `update` | Inventory advice, advisory queries, self-update plan |
| `email` | DNS records, external todos, health score, stack install plan |
| `agents` | Outbound agent comms + OpenClaw/Hermes/IonClaw runtimes |
| `controllers` / HTTP | Control-plane API |
| `cli` | `ysk-server` commands |
| Web (`apps/web`) | Feature-sliced React UI + i18n |

## Dependency rule

Controller → Service → Repository / pure policy modules. No circular deps.

## Security posture

1. LLM is untrusted
2. Default read-only Allowlist; unknown tools fail closed
3. High-risk tools require Human Approval
4. RBAC three-axis enforcement
5. Kernel Sandbox plans for constrained execution
6. Full audit of approvals and updates

## Packages

```
packages/shared  — DTOs, types, errors
packages/core    — pure business logic (highly unit-tested)
apps/server      — HTTP + CLI binary `ysk-server`
apps/web         — React dashboard
```

## Runtime data

Default data directory: `.ysk/` or `/var/lib/ysk-server` (production).
