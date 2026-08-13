# Security audit — ysk-server 1.0.8

> Language: English | [中文](./audit-1.0.8-ZH.md)

Live audit of the shipped 1.0.8 control plane. Findings are **Fixed**, **Accepted**, or still **Open**. Confirmed issues are remediated fail-closed with tests.

Threat model: panel port reachable from an untrusted network. Attacker profiles: anonymous, low-privilege session, admin without EXECUTE, admin with root+EXECUTE.

## Methods

Attack-surface inventory · STRIDE · OWASP ASVS L2 / Top 10 · RBAC vs `route-capabilities` · crypto/secrets · injection / path / SSRF · install supply chain · re-check of S0 / S1 / S2 / P7 / I-*.

Tests exercise **defences** (401 / 403 / 422 / blocked host). No exploit payloads.

## Public surface (A0)

| Path | Auth | Notes |
|------|------|-------|
| `GET /health`, `GET /api/v1/health` | none (liveness) | Execute/root fields **only when authenticated** |
| `GET /api/v1/status` | none (subset) | Full dataDir/tools/execute only when authenticated |
| `GET /api/v1/readiness` | none (boolean) | Full items / project homes only when authenticated |
| Autoconfig / Autodiscover XML | none | Domain query required; no mailbox list |
| `GET /api/v1/public/files/:token` | share token ± password | Rate-limited; header password preferred |
| `/webdav/*` | Basic ysk:token | Rate-limited |
| `WS /api/v1/public/bt-tracker` | none | Proxies loopback tracker only |
| Login / logout | public | Login rate-limited |

WebSocket (ticket required): terminal, VNC, host-browse.

## Findings

| ID | Sev | Area | Status |
|----|-----|------|--------|
| A08-1 | Medium | Unauthenticated `/health` leaked `executeEnabled` / `isRoot` | **Fixed** |
| A08-2 | High | Unauthenticated `/api/v1/readiness` ran full assess + project `homeDir` | **Fixed** — public probe is boolean only |
| A08-3 | High | `requireUserTotp` was advisory; APIs usable without enroll | **Fixed** — `enforceMustEnrollTotp` + login redirect `/security` |
| A08-4 | Medium | Share password on JSON (`meta` / `bt-stats`) query string | **Fixed** — query only on file/torrent GET; panel fetch uses header |
| A08-5 | High | Backup S3 endpoint / SFTP host could target IMDS / loopback | **Fixed** — `assertSafeOutboundUrl` / `isMetadataOrLoopbackHost` |
| A08-6 | Medium | Backup SSH used `StrictHostKeyChecking=no` | **Fixed** — `accept-new` |
| A08-7 | Low | API/SPA missing Content-Security-Policy | **Fixed** — API `default-src 'none'`; SPA self + ws |
| A08-8 | Critical | `bash -c` with the word `postqueue`/`grep` treated whole script as read-only (`reboot` companion) | **Fixed** — deny power/firewall verbs; postqueue only `-p` / if-wrapper |
| A08-9 | Medium | Any session could `GET /api/v1/terminal/targets` (linux users + homes) | **Fixed** — `settings.system` or `services.control` |

## Accepted residual

| ID | Reason / operator control |
|----|---------------------------|
| R-1 | `root` + `YSK_EXECUTE=1` is host-equivalent by design. Keep EXECUTE off when idle. |
| R-2 | Share **file** GET may still use `?password=` for `<a href>` / torrent. Prefer header. Access logs may record it. |
| R-3 | Password-based SFTP uses `sshpass` (process/env visible to root). Prefer SSH identity vault. |
| R-4 | First SSH backup still `accept-new` (TOFU). Pin known_hosts for production. |
| R-5 | Install checksum pin (I-07) remains operator-documented. |

## Re-check of prior phases

S0 fail-closed `isMutatingArgv`, S1 session hash / XFF / cron / SQL escape, S2 status subset / CDN SSRF / share+WebDAV rate limits — still in tree. This pass did not reopen them except as above.

## Verification

```bash
pnpm --filter ysk-server exec vitest run \
  src/routes/public.test.ts \
  src/http/auth-guards.enroll.test.ts \
  src/controllers/system-controller.test.ts
pnpm --filter ysk-server-core exec vitest run \
  src/hosting/backup-remote.test.ts \
  src/net/ssrf.test.ts
```
