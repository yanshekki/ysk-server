# Secondary development guide

Language: English | [中文](./secondary-dev-ZH.md)

## Layers

```
packages/shared  → ErrorCodes, CapabilityId, DTO, list-query, i18n
packages/core    → domain service / apply / HostExecutor
apps/server      → thin HTTP: auth → validate → service → sendOpsResult | sendError
apps/web         → shared DTO + feature api only (never import core)
```

Canonical worktree for product changes: `/home/ki/文件/ysk-server/`

## New endpoint checklist

1. Register capability + mutating route cap  
2. Shared DTO  
3. Core apply (real, honest `written`/`applied`/`blocked`)  
4. Route using helpers below  

```ts
const user = requireUserCap(ctx, req, 'projects.write');
const body = await readJsonBody(req);
const name = requireString(body, 'name', { min: 1, max: 80 });
sendOpsResult(res, await someCoreApply({ name, actor: user.username }));
```

## Helpers

| Helper | Path |
|--------|------|
| Body validation | `apps/server/src/http/validate.ts` |
| Auth + cap | `apps/server/src/http/handler.ts` |
| Ops HTTP status | `sendOpsResult` in `http/util.ts` |
| List/search | `http/list-response.ts` |
| Honesty layer flags | `honestyFromFlags` from `@ysk-server/core` |
| SSRF | `assertSafeOutboundUrl` from `@ysk-server/core` |

## Domain ownership

- **Users / packages mutations** → `routes/admin.ts` (not `misc.ts`)  
- Residual god-file drain is ongoing; do not add new features to `misc.ts` or `cli.ts` bulk switches.

## Security

See `docs/security/phase-s0-hardening.md` … `phase-s2-hardening.md`.
