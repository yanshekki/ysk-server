# Changelog

## 1.0.0 — 2026-08-12

### Product
- **First public free release** of YSK Server (panel + CLI)
- Install path aims for **ready-to-use**: root installs enable/start `ysk-server.service`, print bootstrap credentials, HTTPS panel URL
- Uninstall: `--all` removes product CLI/unit unless `--keep-product`
- New panel **Support** page (`/support`): Creator, donate (GitHub Sponsors + [Linktree](https://linktr.ee/yanshekki)), crypto handles (`yanshekki.eth` / `yanshekki.near` / `$yanshekki`), YSK Limited services (no prices), contact **email@ysk.hk**
- Product-oriented README; agent skill at `.grok/skills/ysk-server/SKILL.md`
- Global search redesigned (pages + resources, grouped UI)
- BT Tracker / public shares / WebTorrent self-host + tracker proxy (see prior commits)

### Note
- Host mutations still require root + `YSK_EXECUTE=1` (honest ops)

## 2026-08-09

### Security
- Phase 0: file sandbox boundary, WebDAV Basic user enforcement, constant-time token compares
- Phase 7: public-share passwords use salted `scrypt$salt$hash` (legacy SHA-256 still verified)
- Phase 7: rate-limit public share and WebDAV Basic auth failures (IP-scoped lockout)
- Phase 7: harden `pathAllowed` empty-root / bare-`/` edge cases

### UI
- Removed AI Tasks / Agents panel navigation (CLI retained)
- Unified professional About / 說明 tab layout with CLI hints
- Tier-1 locale glossary hardening (zh-HK)
- Locales: Tier-1 (zh-HK / zh-CN / en) + Tier-2 including **Japanese** and **Korean** (13 locales, full key parity)
- Tier-2 catalogs translated from English (`scripts/i18n-mt-from-en.py`) with UI glossary overrides
- RTL document direction for Arabic (`ar`) and Urdu (`ur`)

### Docs / CLI
- Panel↔CLI parity matrices refreshed (EN+ZH); CLI help unit tests
- Feature docs: WebDAV, public shares, global webmail
- i18n + security docs updated for Tier-2 locales and Phase 7 review (EN+ZH)

## Unreleased

- **Host Browse audio**: optional PCM bridge (`audioBridge` / `YSK_HOST_BROWSE_AUDIO`) — HTML media `captureStream` → live WS s16le → panel Web Audio unlock
- **Host Browse tabs**: server-backed multi-tab REST + WS (`/tabs`, `tab_open|switch|close`); UI chips call real Playwright pages
- **Host Browse downloads / resume / safety**: download intercept drawer; lastSnapshot resume; safety level + block hosts + dangerous downloads
- **Host Browse isolation**: ephemeral `yskb_*` users + Chrome-as-user CDP when root+EXECUTE
- **Host Browse e2e**: `pnpm e2e:host-browse` (unit + docs surface gate)
- **Host Browse shell**: scroll fix, compact chrome UI, home/bookmarks/history, multi-tab UI, heartbeat reap, ephemeral Linux user lifecycle, danger navigate policy
- **Host Browse live**: quality presets (smooth/balanced/sharp), dynamic viewport + zoom, letterbox mouse map, screencast restart, structured live/nav errors + retries

- **Host Browse 100%**: dual engine — Proxy (form POST, rewrite, abort/history) + **Real browser** (playwright-core + system Chrome, screencast WS, mouse/keyboard); `YSK_HOST_BROWSE_*` env; docs updated
- **Host Browse panel**: one-click `chromium` install (Software tab + hub card); panel settings for engine/path/loopback/no-sandbox (DB overrides env)

- **Host Browse** (`/browse`): host-mediated proxy browser (internet + intranet modes), capability `network.browse`, server-side cookie jar, fixed Host-Browse UA, SSRF policies, sandboxed content frame; API `/api/v1/host-browse/*`
- **HostSoftwareProbe**: single class for presence / version / upgrade; MySQL vs MariaDB exclusive; service-console, db-engine, probeSoftware, stack, service-matrix, redis, FTPS, UFW/fail2ban, restic, PowerDNS, pm2; `pnpm probe:ssot` in gates
- **install redesign**: plan/bundle wizard (`recommended` / `full` / `minimal` / custom); SSOT `deploy/stack/{bundles,components}.json`; `stack-manifest.json`; non-interactive default **recommended** (not full)
- **uninstall.sh**: partial or full removal by bundle/component; `--keep-data` (default) vs `--purge-data`; product removal optional; install/uninstall logs under `/var/log/ysk-server/` or `~/.ysk/logs/`
- **stack core + CLI + API + Web**: `@ysk/core` `hosting/stack/*`; `ysk-server stack plans|status|scan|expand|install|uninstall`; REST `/api/v1/system/stack/*`; Services page **Stack** tab wizard
- **software probe**: `binExists` expands PATH + absolute sbin/bin paths; mysql-client accepts `mysql`|`mariadb`, mariadb-server accepts `mariadbd`|`mysqld`

## 0.1.0 (in progress — honest status)

Production-oriented control plane with **real** Node/PHP listen paths, durable JSON store,
Web UI served from `serve`, and fail-closed host mutations (`YSK_EXECUTE`).

### Wave 2 — architecture · honesty · unification (2026-07-30)

Full-system coding review stack **R0–R7** (see [docs/architecture/code-review-wave2.md](./docs/architecture/code-review-wave2.md)).

**Architecture & contracts**

- `@ysk/shared` domain DTO modules: metrics, network, system, databases, ftp, files, email-domain, fleet, software, ssl, updates, ai — web `features/*/api.ts` re-exports; core metrics/readiness/host overview align
- HTTP: `http-server.ts` reduced to ~120 LOC dispatcher; domain handlers under `apps/server/src/routes/*` (+ existing `controllers/*`)
- Inventory: `pnpm review:inventory`; feature single-entry map in `docs/architecture/feature-single-entry.md`

**Product IA / honesty**

- Defense single entry: `/protection`; tools at `/protection/firewall` and `/protection/fail2ban`; legacy paths redirect (query preserved)
- Removed dual Dashboard/Services/Readiness fail2ban+firewall CTAs; deleted deprecated `DbServicePage`
- CDN fleet: real `enqueue` of `cdn.edge.apply` / `cdn.edge.purge`; agent CLI handler `runCdnFleetPayload`; UI fleet session field; **queued ≠ applied** (never fake applied)
- Ops honesty: remaining `sendJson(ok?200:422)` CDN/DNS paths → `sendOpsResult`

**UI kit & CSS**

- PageGuide「說明」tab gate: `pnpm about-tab:check` (in `pnpm gates`)
- Removed dead UI: `ExecutionResultPanel`, `KeyValueList`, `ResourceTable`, `CapabilityBanner`, `SettingField` (+ related CSS)
- CSS: monorepo `styles/components/*.css` modules (barrel `components/index.css`); `components.css` is re-export shim
- Inline style policy: layout/spacing via utilities; meters use `--meter-pct` CSS variables only

**CI hard gates (root `pnpm gates`)**

```text
honesty:lint → primitives:check → chrome:check → about-tab:check → css:reuse
→ i18n:check-keys → i18n:check-ui → i18n:check-api
```

Then typecheck / build / test / e2e as before.

### i18n L0–L5 (2026-07-30)

- **L0–L2**: Shared locales, shell/UI, feature pages
- **L3**: Request locale (`tl` / Accept-Language / CLI); `errors.*` + `ops.*`; auth; EXECUTE blocked; `ApiError`
- **L4**: Core/server operator notes under `notes.*`; web blocked detection + i18n operator messages
- **L5**: Hard gates — `i18n:check-ui` + `i18n:check-api` in `pnpm gates`
- **L2.1**: Page guide bodies in `guides/data/{zh-HK,zh-CN,en}.json` (45); locale-aware `getPageGuide`; PATCH `/api/v1/auth/locale` + login applies `user.locale`
- **Polish**: `scripts/polish-i18n-followup.py` clears CJK from `notes` EN; regenerates zh-CN page guides from zh-HK

See [docs/i18n.md](./docs/i18n.md).

**Deferred (documented, not blocking Wave 2 close)**

- Fat `system-controller.ts` / residual `routes/misc.ts` further slice
- God pages (Protection, Logs, Cdn, …) feature-ui split
- DescriptionList vs InfoCard documentation-only overlap

### Implemented (usable)

- Monorepo: `@ysk/shared`, `@ysk/core`, `@ysk/server`, `@ysk/web`
- Auth, Allowlist, Approval, Audit, RBAC hooks, Protection probes + scheduler
- Projects: disk homes, deploy Node/PHP (health), git deploy, env, backup, logs, quota, resources
- **Node deploy modes**: systemd → PM2 → pidfile (ecosystem always written; no fake PM2 success)
- Templates: `node-starter`, `static-site`, `wordpress-php` (+ optional WP download)
- Nginx managed conf + optional system reload; SSL PEM upload; Let’s Encrypt plan
- DB: MySQL / PostgreSQL / Redis provision or structured refuse (no fake success)
- Email: DKIM, DNS checklist, live-check, multi-DNSBL, warm-up, SMTP relay
- Cloudflare DNS apply (token); fail2ban jail.local; FTPS config
- Fleet agents + managed AI runtime probe/install templates
- CLI: setup, serve, projects (create/deploy/…), templates, hosting DB helpers, agents probe
- Docs: Spec, production-mvp, real-ops, npm-publish, CLI reference, API overview
- Release helper: `scripts/prepare-release.sh` / `pnpm prepare-release`
- Web FSD slices: projects, email, agents, dashboard, updates, system, security, files
- Coverage: gitSync local clone/pull, scheduler, probeTcp, pm2-apply, dns-zone, firewall refuse
- BIND zone files (`dataDir/dns/zones`) + UFW script writer (fail-closed apply)
- PowerDNS plan/load/install (`pdnsutil` + apt helper); certbot refuse without EXECUTE
- Email MTA: milter, master.cf snippet, KeyTable, install-mta.sh; fail-closed install
- PM2 `save` after successful start; AI/llm FSD; AiTaskService tests
- CLI: hosting dns-zone, powerdns-*, email-apply, firewall-apply
- Mailbox Maildir provision + virtual maps API/CLI/UI; FTPS fail-closed install
- Self-update `ok` flag; project setEnv/backup coverage in ops tests
- Runtime probe/install (Node/PHP multi-version); Dovecot passdb export; fetchTransport tests
- PHP deploy: FPM+nginx fastcgi production path vs php -S; SHA512-CRYPT mailbox hashes
- OSV inventory mock tests; renderNginxPhpFpm
- Roundcube webmail plan/apply; coverage for protection/operation-level/repos
- deployStatic nginx path; host executor blocks rm/crontab/pm2 without EXECUTE
- Repo tests (session/project); playbooks startPlaybookRun coverage
- e2e: static/DNS/PowerDNS/mailbox/webmail/firewall; cron setEnabled; live-checks DNS mocks
- Spec production readiness probe (`readiness` / doctor); public file server apply
- OS isolation via bash -c useradd/chown; re-provision API
- install.sh embeds Web UI + CLI wrapper; pack includes public/web
- Dashboard Spec readiness banner; more tool-executor / os-provision tests
- GitHub CI; Spec §5 email bootstrap; outbound-agent + deployPhp tests

### Still partial / Spec backlog

- Roundcube SSO polish; full agent vendor installers
- ≥90% coverage target (Spec §2.4); public npm packages published

### Earlier scaffolding notes

- Phase 1 scaffold: monorepo, i18n, allowlist, LLM gateway, install.sh
- Phase 2 contracts expanded into real-ops vertical (see `docs/deploy/real-ops.md`)
