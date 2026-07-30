# YSK Server Architecture

## Layers (actual)

| Layer | Package / path | Responsibility |
|-------|----------------|----------------|
| **Contracts** | `@ysk/shared` (`types.ts`, `dto.ts`, `ops.ts`, `errors.ts`) | Enums, DTOs, **OpsResultDto / ApplyStatus**, errors — **only** cross-process public types |
| **Business logic** | `@ysk/core` (`hosting/`, `email/`, `security/`, `net/`, `monitoring/`, …) | Pure domain services; unit-tested; returns honest ops results |
| **Persistence** | `@ysk/core` `db/` + `repositories/` | JSON store + repositories |
| **Host adapter** | `@ysk/core` `host/` | Executor (YSK_EXECUTE / root gates) |
| **HTTP + CLI** | `apps/server` | Thin controllers / CLI → core; use `sendOpsResult` |
| **Web UI** | `apps/web` | FSD-lite React; import DTOs from `@ysk/shared`; UI kit only |

## Dependency rule

```
Web / CLI / HTTP  →  @ysk/shared (types only)
HTTP / CLI        →  @ysk/core (services)
@ysk/core         →  @ysk/shared
```

No circular deps. Controllers must not own business rules.

## Ops honesty contract

Canonical type: **`OpsResultDto`** + **`ApplyStatus`** in `@ysk/shared/ops.ts`.

| apply_status | Meaning |
|--------------|---------|
| `draft` | Control-plane row only |
| `written` | Managed files under dataDir written; **not** system-applied |
| `applied` | Host command succeeded (reload / copy / etc.) |
| `blocked` | Needs EXECUTE and/or root; must not report ok success as applied |
| `failed` | Attempted and failed |
| `partial` | Some steps ok |

**Forbidden:** `ok: true` with `blocked: true`, or `apply_status: 'applied'` when blocked.

Use `assertHonestOps()` before returning HTTP/CLI bodies when in doubt.

## Security posture

1. LLM is untrusted  
2. Default read-only Allowlist; unknown tools fail closed  
3. High-risk tools require Human Approval  
4. RBAC three-axis enforcement  
5. Full audit of approvals and updates  

## Packages

```
packages/shared  — DTOs, types, ops honesty, errors
packages/core    — business logic (highly unit-tested)
apps/server      — HTTP + CLI binary `ysk-server`
apps/web         — React control plane
```

## Deprecated / empty shells

`packages/core/src/{dto,types,interfaces,entities}` are **not** used.  
Do not reintroduce parallel public DTOs there — extend `@ysk/shared`.

## CI hard gates

Root script **`pnpm gates`** (also in GitHub Actions before typecheck/build):

| Gate | Command | Enforces |
|------|---------|----------|
| Honesty lint | `pnpm honesty:lint` | No `sendJson(ok?200:422)`; no obvious `ok:true`+`blocked:true` in `apps/server` |
| Page primitives | `pnpm primitives:check` | No raw `<table>` / `btn-row` / create-in-layout on feature pages |
| Page chrome | `pnpm chrome:check` | Feature pages use FeaturePageLayout; OpsHero banned |

Then: `pnpm typecheck` → `pnpm build` → `pnpm test` → `pnpm e2e:real-ops`.

See [code-review-2026-07-30.md](./code-review-2026-07-30.md) for the full PR1–PR6 stack close-out.

## Runtime data

Default data directory: `.ysk/` or `/var/lib/ysk-server` (production).
