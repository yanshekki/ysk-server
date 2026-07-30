# YSK Server Architecture

## Layers (actual)

| Layer | Package / path | Responsibility |
|-------|----------------|----------------|
| **Contracts** | `@ysk/shared` (`types`, `dto`, `ops`, `errors`, **domain DTO modules**) | Enums, DTOs, **OpsResultDto / ApplyStatus**, metrics/network/system/db/ftp/files/email/fleet/… — **only** cross-process public types |
| **Business logic** | `@ysk/core` (`hosting/`, `email/`, `security/`, `net/`, `monitoring/`, …) | Pure domain services; unit-tested; returns honest ops results |
| **Persistence** | `@ysk/core` `db/` + `repositories/` | JSON store + repositories |
| **Host adapter** | `@ysk/core` `host/` | Executor (YSK_EXECUTE / root gates) |
| **HTTP + CLI** | `apps/server` | Thin `http-server` dispatcher → `routes/*` + `controllers/*` → core; use `sendOpsResult` |
| **Web UI** | `apps/web` | FSD-lite React; import DTOs from `@ysk/shared`; UI kit only; i18n via shared locales |
| **i18n** | `@ysk/shared` `locales/` + `i18n/t` | zh-HK（香港書面語）· zh-CN · en；前後端共用 `t(locale, key)` |

## Dependency rule

```
Web / CLI / HTTP  →  @ysk/shared (types only)
HTTP / CLI        →  @ysk/core (services)
@ysk/core         →  @ysk/shared
```

No circular deps. Controllers / route modules must not own business rules.

### HTTP route layout (`apps/server`)

| Path | Role |
|------|------|
| `http-server.ts` | Dispatcher only (~120 LOC): rate window, OPTIONS, static SPA, 404 |
| `controllers/*` | Existing modular handlers (files, system, resources, logs, metrics, network) |
| `routes/*` | Domain handlers extracted in Wave2 R2 (`auth`, `cdn`, `email`, `hosting`, … + residual `misc`) |

Each handler: `(ctx, req, res, url, method) => Promise<boolean>` — `true` = response sent.

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
packages/shared  — DTOs, types, ops honesty, errors, domain API contracts
packages/core    — business logic (highly unit-tested); reuses shared DTO shapes
apps/server      — HTTP (`http-server` + `routes/*` + `controllers/*`) + CLI `ysk-server`
apps/web         — React control plane; features/*/api.ts re-exports shared types
```

### Domain DTO modules (`@ysk/shared`)

| Module | Covers |
|--------|--------|
| `ops.ts` | ApplyStatus, OpsResultDto |
| `dto.ts` | Auth, Project, LLM chat, email DNS health |
| `cdn.ts` / `migrate.ts` | CDN, host migrate jobs |
| `metrics.ts` | MetricsSnapshot, processes, top header |
| `network.ts` | Network snapshot / apply |
| `system.ts` | Readiness, host overview, firewall/fail2ban status |
| `databases.ts` | DB engine/service + Redis keys |
| `ftp.ts` / `files.ts` / `ssl.ts` / `software.ts` | FTPS, files, certs, install |
| `email-domain.ts` / `fleet.ts` / `updates.ts` / `ai.ts` | Mail domains, agents, updates, AI tasks |

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
| About tab | `pnpm about-tab:check` | PageGuide pages expose trailing「說明」tab |
| CSS reuse | `pnpm css:reuse` | No disallowed inline styles; core class patterns present; CSS under `styles/` only |
| i18n keys | `pnpm i18n:check-keys` | zh-HK / zh-CN / en translation key sets match |

Then: `pnpm typecheck` → `pnpm build` → `pnpm test` → `pnpm e2e:real-ops`.  
i18n guide: [../i18n.md](../i18n.md).

See [code-review-2026-07-30.md](./code-review-2026-07-30.md) (PR1–PR6 close-out) and **[code-review-wave2.md](./code-review-wave2.md)** (**Wave 2 CLOSED** R0–R7).  
Single-entry IA: [feature-single-entry.md](./feature-single-entry.md).  
Changelog: root [CHANGELOG.md](../../CHANGELOG.md) § Wave 2.

## Runtime data

Default data directory: `.ysk/` or `/var/lib/ysk-server` (production).
