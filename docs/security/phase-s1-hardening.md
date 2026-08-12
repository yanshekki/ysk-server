# Security hardening — Phase S1 (injection + multi-tenant)

Language: English | [中文](./phase-s1-hardening-ZH.md)

Scope: SQL injection, cron injection, project file access, session storage, proxy IP trust, chown/symlink bounds.

## Findings

| ID | Severity | Area | Status |
|----|----------|------|--------|
| S1-1 | High | MySQL provision password/host injection | **Fixed** — `escapeMysqlString` + `validateMysqlHost` |
| S1-2 | High | Service console `SET GLOBAL ${k}` arbitrary key | **Fixed** — catalog-only + key regex (mysql/redis/postgres) |
| S1-3 | High | Temp DB user unvalidated identifiers | **Fixed** — `validateMysqlIdent` + escaped/dollar-quoted passwords |
| S1-4 | High | Cron schedule/command newline injection | **Fixed** — `assertSafeCronSchedule` / `assertSafeCronCommand` |
| S1-5 | High | Project file roots open to any authenticated user | **Fixed** — require `files.project` cap |
| S1-6 | High | Session tokens stored plaintext | **Fixed** — store `token_hash` + prefix; legacy migrate on use |
| S1-7 | High | XFF spoof for rate-limit IP | **Fixed** — trust only when `YSK_TRUST_PROXY=1` |
| S1-8 | High | chown path prefix escape | **Fixed** — `pathUnderRoot` after resolve |
| S1-9 | Medium | FileManager symlink escape | **Fixed** — `realpathSync` containment when path exists |
| S1-10 | Medium | Remember-device static HMAC fallback | **Fixed** — fail closed via master key only |

## Operator notes

- Behind reverse proxy: set `YSK_TRUST_PROXY=1` so login / share rate limits use real client IPs.
- Non-admin roles need `files.project` to browse `root=project:<id>`.
- Existing sessions with plaintext tokens migrate to hash on next request.

## Verification

```bash
cd /home/ki/文件/ysk-server
pnpm --filter @yanshekki/core exec vitest run \
  src/hosting/db-client.test.ts \
  src/hosting/extras.test.ts \
  src/files/manager.test.ts \
  src/files/manager.depth.test.ts \
  src/services/auth.test.ts \
  src/repositories/session-repo.test.ts
```
