# Security hardening — Phase S0 (Critical gates)

Language: English | [中文](./phase-s0-hardening-ZH.md)

Scope: fail-closed host execute gate, path sandbox, tools FS, fleet agent auth, API key scope, bootstrap password.

## Findings

| ID | Severity | Area | Status |
|----|----------|------|--------|
| S0-1 | Critical | `isMutatingArgv` fail-open for unknown bins / weak bash heuristics | **Fixed** — default requires `YSK_EXECUTE`; explicit read-only catalog |
| S0-2 | Critical | Write-root string prefix allows `/tmp/../etc` | **Fixed** — `pathUnderRoot` with `path.resolve` + boundary |
| S0-3 | Critical | `mkdirp` unrestricted | **Fixed** — same gate as `writeFile` |
| S0-4 | Critical | Tools `fs.read`/`fs.list` any host path | **Fixed** — `assertToolFsPath` under `dataDir` + `fsRoots` |
| S0-5 | Critical | Fleet register / heartbeat / pull / ack unauthenticated | **Fixed** — panel/enroll for register; agent token for edge ops |
| S0-6 | Critical/High | Silent default password `admin` on empty DB | **Fixed** — require `adminPassword` / `YSK_ADMIN_PASSWORD` or insecure opt-in |
| S0-7 | High | API keys global list/delete; `read` scope ignored | **Fixed** — own keys only; read-only blocks mutations |
| S0-8 | High | `must_change_password` advisory only | **Fixed** — HTTP allowlist + `POST /api/v1/auth/password` |

## Verification

```bash
cd /home/ki/文件/ysk-server
pnpm --filter ysk-server-core exec vitest run \
  src/host/executor.test.ts \
  src/security/tool-executor.test.ts \
  src/agents/fleet.test.ts \
  src/agents/outbound-agent.test.ts \
  src/services/auth.test.ts
pnpm --filter ysk-server exec vitest run src/routes/agents.test.ts
```

## Operator notes

- Edge agents must store the **one-time** `token` from register (`ysk_agent_…`) and send `X-Ysk-Agent-Token` (or Bearer) on heartbeat/pull/ack.
- Unauthenticated fleet register requires `YSK_FLEET_ENROLL_TOKEN` or `settings.fleet.enroll_token`.
- Never set `YSK_ALLOW_INSECURE_DEFAULTS=1` on internet-facing hosts.

## Residual (later phases)

- S1: SQL injection (MySQL provision / console keys), cron validation, project file multi-tenant, session hash at rest
- S2: CORS allowlist, public status redaction, SSRF, install checksums
