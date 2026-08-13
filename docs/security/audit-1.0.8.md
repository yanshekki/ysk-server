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
| A08-10 | High | IPv6-mapped IMDS / AWS `fd00:ec2::` / Alibaba `100.100.100.200` bypassed SSRF | **Fixed** |
| A08-11 | High | Unzip zip-slip / parent symlink escape in FileManager | **Fixed** — member list + ancestor realpath |
| A08-12 | High | Imported VPN client `PostUp` / OpenVPN `up` ran as root via wg-quick | **Fixed** — strip hooks on import and before up |
| A08-13 | High | FTP `homePath` could be `/etc` then apply mkdir/chroot | **Fixed** — must be under dataDir or a project home |
| A08-14 | High | Impersonate issued a session as another **admin** | **Fixed** — refuse admin targets + TOTP step-up |
| A08-15 | High | Host Browse `chromePath` launched as panel-process `executablePath` with no allowlist | **Fixed** — packaged Chrome/Chromium prefixes + basename only; invalid env/store dropped |
| A08-16 | High | VNC client `host` / `connectHost` could TCP-proxy to IMDS / link-local metadata | **Fixed** — loopback allowed; IMDS / `metadata` / `fd00:ec2::` / `100.100.100.200` refused |
| A08-17 | Medium | Public VNC share redeem had no rate limit (ticket flood / token guess) | **Fixed** — 30 req / 15m + 10-fail lockout per IP |
| A08-18 | High | OpenVPN client `up` copied stored conf without re-stripping hooks | **Fixed** — strip again before systemd copy; extra hook verbs (`down-pre`, `management`, …) |
| A08-19 | High | VPN `listenPort` interpolated into bash without integer coerce | **Fixed** — `parseVpnListenPort` / `coerceVpnListenPort` |
| A08-20 | Medium | Any authenticated session could `GET` DB/Redis console live values (`requirepass`) | **Fixed** — `mysql.console.write` **or** `services.control` **or** `settings.system` |
| A08-21 | Low | WebDAV PROPFIND unbounded listing; PUT unbounded body | **Fixed** — 500 entries / 50 MiB |
| A08-22 | High | LLM `allowPrivate` if URL string contained `localhost` (IMDS + `?localhost`) | **Fixed** — hostname-only loopback; save-time `assertSafeOutboundUrl` |
| A08-23 | High | Public Autoconfig/Autodiscover interpolated unsanitized `domain`/`email` into XML | **Fixed** — hostname/email allowlist + XML escape; invalid query 400 |
| A08-24 | High | Nginx `server_name` interpolated unsanitized into conf | **Fixed** — token allowlist at list + render |
| A08-25 | High | `GET /settings/llm` returned stored `apiKey` to any session | **Fixed** — `settings.system` + mask `***` |
| A08-26 | Medium | SSH identity list/public/get and fleet agent list were any-session GETs | **Fixed** — identity: `settings.system`/`security.policy`/`backups.run`; fleet: `settings.system`/`services.control` |
| A08-27 | Low | Fleet enroll token compared with `===`; boot splash wrote raw `err.message` to `innerHTML` | **Fixed** — `timingSafeEqual`; HTML-escape boot error |

## Accepted residual

| ID | Reason / operator control |
|----|---------------------------|
| R-1 | `root` + `YSK_EXECUTE=1` is host-equivalent by design. Keep EXECUTE off when idle. |
| R-2 | Share **file** GET may still use `?password=` for `<a href>` / torrent. Prefer header. Access logs may record it. |
| R-3 | Password-based SFTP uses `sshpass` (process/env visible to root). Prefer SSH identity vault. |
| R-4 | First SSH backup still `accept-new` (TOFU). Pin known_hosts for production. |
| R-5 | Install checksum pin (I-07) remains operator-documented. |
| R-6 | Host Browse `--no-sandbox` remains an operator setting for containers. Combined with A08-15, only allowlisted Chrome binaries launch. |
| R-7 | `YSK_HOST_BROWSE_CHROME` / custom Chrome outside `/usr` `/opt/google` `/snap` is ignored (fail closed to probe). |
| R-8 | VNC `server_proxy` may still reach RFC1918 (intended). IMDS is blocked. |
| R-9 | File editor `highlightToHtml` escapes tokens (reviewed). CSP still applies. |
| R-10 | `pnpm audit`: Vitest UI / Vite / brace-expansion / nanoid are **dev**. Transitive `ip@2.0.1` (webtorrent tracker) has no patched release; our SSRF uses `net/ssrf.ts`. Panel SPA uses `BrowserRouter`, not React Router RSC. `react-router-dom` bumped to `^7.18.2`. |

## Reviewed this pass (no extra code change)

Host Browse CDP binds `127.0.0.1` only. Live WS tickets are one-time + TTL. VNC/terminal tickets already consume-once + expire. CDN node health uses `assertSafeOutboundUrl`. Host-migrate temp keys `0600` / dir `0700`. Outline has no script hooks. File editor `highlightToHtml` escapes tokens; other `innerHTML` is VNC canvas clear or escaped boot error. Project OS users are derived from UUID (`ysk-…`), not the project name. Backup GET already masks secrets. Install I-07 still operator-documented (R-5). Public BT tracker WS still proxies loopback only. SQL resource create stays on mutating caps; replica plans use quoted identifiers. npm product pack is `dist` + `public` + README (no extra secrets found).

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
  src/net/ssrf.test.ts \
  src/host-browse/chrome-path.test.ts \
  src/hosting/vnc/client-profiles.test.ts \
  src/hosting/vpn/client-conf-protect.test.ts \
  src/hosting/vpn/ports.test.ts \
  src/security/mfa/rate-limit.test.ts \
  src/llm/http-transport.test.ts \
  src/email/autodiscover.test.ts \
  src/hosting/nginx-ssl.test.ts \
  src/host-browse/live-ticket.test.ts
```
