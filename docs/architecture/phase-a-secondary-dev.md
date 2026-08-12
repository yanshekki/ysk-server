# Phase A — Secondary-development architecture (2026-08-09)

Language: English | [中文](./phase-a-secondary-dev-ZH.md)

Completes the S0–S2 security program foundation with reusable HTTP contracts and domain ownership.

## Delivered

| ID | Item | Status |
|----|------|--------|
| A1 | `http/validate.ts` — `readJsonBody`, `requireString`, `requireEnum`, … | **Done** |
| A1 | `http/handler.ts` — `requireUser` / `requireUserCap` | **Done** |
| A1 | Auth password change uses validators | **Done** |
| A2 | Users/packages mutations moved misc → `routes/admin.ts` | **Done** (~170 LOC off misc) |
| A3 | `honestyFromFlags` + `applyStatusFromHonesty` documented + re-exported | **Done** |
| A3 | honesty-lint soft warnings for residual `ok?200:4xx` | **Done** |
| A4 | Secondary-dev guides EN+ZH | **Done** |

## Residual (not blocking 100% security program)

- Full split of `cli.ts` / `system-controller.ts` / remaining `misc.ts` (multi-week)
- Convert all soft honesty-lint hits to `sendOpsResult`
- OpenAPI / route registry table

## Verification

```bash
cd /home/ki/文件/ysk-server
node apps/server/scripts/honesty-lint.mjs
pnpm --filter ysk-server exec vitest run src/http/validate.test.ts
pnpm --filter ysk-server exec vitest run src/routes/misc.test.ts -t 'users PATCH'
pnpm --filter @yanshekki/core exec vitest run src/hosting/apply-honesty.test.ts
```
