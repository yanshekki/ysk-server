# Changelog

## Unreleased

## 1.1.3 — 2026-08-16

### Improve
- Docker page redesigned: install-first overview, status cards, and selection-first pull / run / prune / settings (no more typing `PRUNE` in the panel)

### Fix
- Validator wizard / table show English chain and network names (Ethereum, NEAR, Sui, Hoodi…) from a catalog SSOT — they are never machine-translated
- Docker / Compose stay English in every locale (no more “stevedore” / “撰寫” / “作曲する”)

## 1.1.2 — 2026-08-16

### Fix
- Panel self-update no longer restarts systemd before the HTTP 200; a dropped connection is treated as restart, not `Failed to fetch`
- Docker actions stay disabled until Docker Engine is installed; prune always needs `PRUNE`
- Validator chain / network / Beta / RPC / Pruned names stay English; wizard install is blocked without Docker
- CDN chip interpolation (`statOnline` / `statDraining`) and locale date format
- `metrics.batchTerm` no longer translates TERM as 學期 / 学期

### Improve
- Docker compose empty state explains there is no YAML upload; run modal exposes ports / env / volumes
- Validator wizard step labels, disk estimate, copy-CLI, auto-clear risk
- Protection suspect counts split listed vs actionable; CF Under Attack on/off share the same zone gate
- Login remounts on language change; dashboard loading no longer stacks three 載入中

## 1.1.1 — 2026-08-16

### Improve
- GitHub and npm product READMEs redesigned (hero, badges, screenshots, install path)

## 1.1.0 — 2026-08-16

### Feature
- Docker engine page `/docker` + `ysk-server docker` (install via apt `docker.io` + compose v2; containers, images, volumes, networks, Compose, prune, safe daemon.json)
- Validators (Beta): panel `/validators` + `ysk-server validators` for L1 nodes — Phase 1 (ETH, AVAX, NEAR, ADA) and Phase 2 (BTC pruned, Cosmos Hub, Sui, Aptos, Polkadot, Solana heavy). Non-custodial. Mutations need `YSK_EXECUTE=1`
- Validator upgrades health-check and roll back to the previous image/tag on failure
- Cardano Mithril one-click snapshot restore (`validators mithril`)
- Ethereum EL×CL matrix: Geth / Nethermind / Reth × Lighthouse / Prysm / Teku / Nimbus

### Fix
- SFTP batch stdin uses a real newline (`printf` + ANSI-C quote); backup remote password path uses the same helper
- Panel TLS status reports the real listen host (`0.0.0.0` stays `0.0.0.0`); bootstrap self-signed cert is labelled; CLI probes `ss`
- Process table cannot TERM/KILL PID 1 / init / systemd; backend already refused PID 1
- Saving “require 2FA” is disabled until the actor has TOTP enrolled; settings API refuses the policy otherwise
- vsftpd start is disabled when `listen` and `listen_ipv6` are both YES; form shows live file values and one-click IPv4-only
- Project web stats no longer fall back to the host-wide `/var/log/nginx/access.log`
- Git `git -c safe.directory=…` is parsed as read-only (value token is skipped)
- CDN loopback origin is rewritten or refused on a remote edge; online + `baseUrl` does not inherit leftover root SSH
- Request-rate “/ min” uses a 60s window (not a growing buffer)
- Production readiness leftover findings are one item each (CLI / Apache / vsftpd)

### Improve
- Panel honesty for UX39-001–254: confirms, titles, probing skeletons, tab aliases, geo/MMDB gates, PASV public IP, bound TLS cert on project HTTPS, sshd enable-on-boot, HA banner localisation
- 13 locales filled for recent keys; zh-HK stays written Chinese; product names stay English
- `ysk-server fleet` documented as the top-level alias of `agents fleet`

## 1.0.39 — 2026-08-15

### Fix
- Project Git: pick branch/tag from `git ls-remote` (no EXECUTE); `git -c safe.directory=<repo>` so root can read a project-owned tree; `GET …/git/diff` + CLI `projects git diff`
- Nginx conf preview does not turn `set_real_ip_from` CIDRs into ban links; empty project domain reads `server_name` from the conf (including `localhost`)
- Protection / fail2ban / intel will not one-click ban the host egress IP, the current login IP, or ignoreip; fail2ban can suggest those IPs for the panel ignoreip file
- Panel HTTP hits are shown as panel traffic and do not raise the threat score; live process table drops the sampling `ps` row
- zh-HK systemd install copy keeps `/etc/systemd/system` and `daemon-reload` in English
- Disable panel HTTPS, remove a software pack, and delete the default route require a confirm phrase; pack remove is disabled when nothing is checked
- Create VNC / MySQL replica / apply Outline is disabled when that engine is not installed; DNS apply is disabled without NetworkManager
- Unknown panel paths show a 404 (not a silent dashboard). `/php-fpm`, `/opendkim`, `/shadowsocks`, `/ask` redirect to the real page; `/agents` is the fleet page again
- Service cards open `/vpn?tab=wireguard|openvpn|outline`
- Schedule `lastRun` is seeded from last inventory / backup / DNSBL / GeoIP; a manual scan updates the job
- 2FA policy save does not require TOTP when this account has no 2FA
- BT announce rejects a short hostname (`demo-server`); prefers FQDN (`hostname -f`) or a usable IP
- Apache “Global settings” works from any tab; Logs empty query says “no rows in this window”; `?tab=help` maps to About
- `crontab -l` is read-only; Files `/` normalizes to `.`; SFTP-only users are not tested with `scp`
- CDN apply rewrites loopback origin with bind IP; implicit `sshUsername=root` is not treated as SSH when a fleet/base URL is present
- doctor / readiness `--help` stay help; leftover Apache copy no longer claims the stock site is on public :80

### Improve
- Footer shows live panel version; global search is debounced; page tabs wrap and keep aliases
- SSL renew on the cert table; dates use the UI locale; `/approvals` goes to Security
- Support page copies a diagnostic summary; operator factory role shows a high-risk write warning (caps unchanged)
- GeoIP freshness is n/a when no MMDB exists; metrics alerts text is translated

## 1.0.38 — 2026-08-15

### Fix
- `update --help` / `update help` print usage and do not run a version check
- `backup status` lastRun no longer treats every English note as a skip (`n1252` was empty, so `startsWith('')` matched all notes)
- `cmd leaf --help` prints that leaf’s usage (`email send`, `ssl issue`, `users delete`, `backup restore --target`)
- Self-update notes warn about a leftover `~/.npm-global` CLI (does not delete it)
- Read-only leftover probe (`ysk-server hosting leftovers` + readiness): Apache default site, missing nginx catch-all, failed vsftpd, Dovecot TLS to a missing cert. Overlay still does not rewrite those host files
- Firewall / fail2ban header chips use panel i18n (`active` / `installed`), not a server `activeLabel` that stays in the last request language
- Panel `Accept-Language` keeps ja/ko/fr/… (no longer forced to zh-HK)
- VPN “engine not installed” / “server not listening” alerts are translated (13 locales)
- Service exposure no longer treats UFW `inactive` as active (`/active/i` matched the substring); VPN cards pass whether the engine is installed
- BT Tracker “Torrent N” counts the library/share list; leftover tracker announces are a warning, not a fake row
- Global search does not flash “no results” before the query finishes
- Create-project version chips show the offline fallback immediately, then swap in discovery results
- BT Tracker add-torrent modal, extra-tracker tab, and library list restyled: no native file-picker chrome, sectioned add flow, tracker card with empty state
- BT library can seed files that already exist (no dead-end 「已有同名項目」); empty dest shows 下載中 not 檢查中; Start stays disabled until the dest conflict is resolved
- Project Git: optional repo URL + branch on create (no clone / no empty goLive), panel branch or tag field, confirm before first clone or remote change, Files `?path=` follows the query, quieter `pm2 delete` when no app, header warns when Node fell back to `/usr/bin/node`
- Page tabs no longer show a leftover vertical scrollbar (horizontal overflow uses the arrow buttons)
- Create / edit user language lists all 13 panel locales (not only zh-HK)
- Project Git control: live status (dirty / behind / shallow / detached), classified errors, pull blocked on Files edits, `.env` restored after sync, fetch / checkout / reset, commit log; CLI `projects git status|log|fetch|checkout|reset`
- Project Git auth: encrypted HTTPS token, per-project SSH deploy key, pinned `known_hosts` (no silent `StrictHostKeyChecking=no`); token never stored in the remote URL
- Project Git inbound hook: `POST /api/v1/hooks/git/:id` with HMAC or `X-YSK-Git-Hook`; enable/rotate/disable from the App tab; full URL + copy; other-branch pushes skipped; operator pastes the URL into GitHub/Gitea/GitLab (not Slack)
- Control-plane backup Preview lists the archive (`tar -tzf`); it no longer looks up a project row
- Backup “Test destination” uses the unsaved form (does not persist)
- CDN node probe classifies timeout / DNS / refused / TLS instead of only `fetch failed`
- Redis cluster peer bundle README is Redis (not Galera / MySQL)
- Dry-run cluster push notes no longer display as “system change is off”
- Remote DB hosts have Test connection (TCP); migrate inventory lists leftover `/home/ysk-server-<uuid>`; panel / CLI `migrate orphan-homes` deletes only with confirm + EXECUTE
- Cluster wizard can paste a `/agents` fleet session id (non-SSH path)
- Backup SFTP test uses the saved outbound identity (same as `backup all`); form can pick the identity; missing key/password is not shown as EXECUTE-off
- Remote SFTP push `mkdir -p`s the dest dir and copies the SQL sidecar next to the tar
- `db-cluster create --kind postgres-replica` infers `--engine postgres`; postgres probe runs as `postgres`
- CDN apply does not invent `root@publicIpv4`; loopback origin is rewritten or refused on a remote edge
- Login authorized_keys can target an existing Linux user with 0 projects; SSH key test treats nologin as PASS
- `software get postgresql` treats an active unit as installed when `postgres` is not on PATH

## 1.0.37 — 2026-08-15

### Feature
- BT Tracker library: upload a `.torrent` (or magnet), pick a Files folder, download or seed with in-process **WebTorrent** (no extra client)
- Extra Trackers tab: operator-managed announce list used when downloading and seeding (empty by default; never a canned public list)
- Torrent tab redesigned as a progress library (not a hash admin table)

### Fix
- Store merge no longer resurrects a project or cron row another process deleted
- `backup status` lastRun uses `ok` / `results` (a successful `projects backup` is not “0/0 failed”)
- `backup all` treats YSK_EXECUTE blocks as failures, not “all skipped / success”
- `tar -tzf` list-only restore preview is read-only (no EXECUTE)
- `backup restore --target` can extract into the project home or public files root
- Control-plane archives on `/backups` offer Preview only (not project 還原網站 / 完整還原)
- `notifications create|send|…` exits 2; only `list` exists (no invented Slack/webhook)
- `cmd --help` shows that command’s help, not the global page; CJK command names get an English-only hint
- Postgres provision notes redact `PASSWORD '…'`
- VNC password failure rolls back a newly created Linux user
- Global search falls back to the project list so a name like `hello` is found
- Readiness export is an authenticated attachment (`GET /api/v1/readiness/export`)
- WebDAV disable/reissue persist and surface a mismatch if the write did not stick
- VPN add-peer failures stay on the page (not silent)
- API key delete asks for confirm; SSH private-key modal X closes without treating the key as saved
- Root-shell confirm is translated (no English default on zh-HK)
- Notifications feed can search, filter, and hide rows (session only — still no outbound channel)
- MariaDB host-only databases have a Register CTA; Node recorded-but-missing has an install CTA
- Firewall rows do not claim 公網 live when UFW is off
- DNS mail-zone CTA creates the zone when an IPv4 is known
- Dashboard failed chips sort first and say 前往處理; Email/FTP pages link Dovecot/vsftpd failures
- `install.sh --upgrade` warns about a leftover `/root/.npm-global` CLI
- Missing mail LE files write Dovecot `ssl=no` instead of pointing at absent paths
- Project backup dumps a SQL sidecar when `.db.env` is present (home tar still excludes secrets)

## 1.0.36 — 2026-08-15

### Fix
- CLI parses `--data-dir` / `--locale` (space or `=`) before the command; `YSK_DATA_DIR` works; root uses `/var/lib/ysk-server` when that store exists
- `--help` never runs list/export/schedule/setup/serve
- `security sessions revoke-others` needs `--user`; API keys need `--name` (default scope read)
- CLI language defaults to English (`--locale` / `YSK_LOCALE`); command names stay English
- `dig` / Redis GET·KEYS are read-only (no EXECUTE)
- Create-project modal is opaque; CDN tab is not `站點 {{n}}`; fail2ban stop copy is honest
- Readiness export toast uses a real string; file names cannot contain `/`
- `defense ban --execute` without `YSK_EXECUTE` does not write a fake panel ban; `fail2ban-client status` / `ufw status` are read-only
- UFW deny while inactive is not `ok` (rules would not hit the kernel); probe lists `user.rules` as configured, not live
- Protection 「活躍封禁」and the 封禁 tab count are enforced bans only (no suspect-count badge; no fail2ban+panel double row)
- CLI and panel no longer clobber each other’s `ysk.json` (lock + merge) — CLI-created projects stay listed
- Deploy prunes orphan `ysks_*` nginx vhosts so a vanished project cannot shadow a live `server_name`
- `hosting postgres-provision` uses `postgres` peer auth (unix socket), not `psql -h 127.0.0.1` as root
- Rust scaffold / deploy defaults to `./target/release/<crate>` — missing `./app` does not write a 203/EXEC unit
- vsftpd apply does not enable TLS without a certificate; FTP CLI create no longer prints `password_plain`
- MariaDB→MySQL switch initializes an empty datadir and rolls back when the target unit will not start
- `ysk-server db databases|users` lists live `SHOW DATABASES` / `mysql.user` (no passwords)
- CLI `--limit` / `--offset` slices large JSON (`software list`, `updates inventory`, `host metrics`, `rbac audit`)
- Email health 10/100 without a probe is labelled **not checked**; project 更多 tab no longer greys the header as busy
- Public files suggests `files.<host>`; uninstalled `/services` rows have one install CTA
- Firewall services tab warns when UFW is off; uninstalled vsftpd/MySQL rows are marked 未安裝
- MariaDB / MySQL pages show live `SHOW DATABASES` names so a running engine is not “0 databases”
- DNS zone list offers a create-zone action for email domains that have no zone
- `runtimes install` / `hosting runtime-install` need `--kind`; software uninstall-preview needs a target
- Same-id store merge no longer clobbers another process’s TOTP or password; /security does not treat a failed TOTP load as 「未設定」
- Passkey register is disabled when the page is not a usable WebAuthn context; step-up is disabled until a passkey exists
- `/security` leftover English (change-password / fail2ban) is translated in all 13 locales
- SSH test-connection keeps the result in the dialog and a top-right toast; Strict preview is no longer hardcoded English
- `?tab=ssh&ssh=system` opens 系統 sshd (URL rewritten); unknown SSH slugs no longer silently stay as outbound
- SSH 「異常」 badges show `lastVerifyNote`
- Store settings merge no longer re-enables WebDAV or drops `last_backup_run` when another process persist()s
- WebDAV PUT is an empty 201; `/webdav/../` is 400; `/share/<token>` serves the file (not the SPA)
- `users delete` / `projects delete` / `nginx delete` / `ssl issue --domain` / `email send` / `dns zone --delete` / `dns records add` are real CLI
- Unknown Host/SNI hits a catch-all `default_server` (`ssl_reject_handshake`) instead of another site
- VNC password fails closed without `vncpasswd` on the EXECUTE path (TigerVNC hint); no-EXECUTE still writes account meta; VPN failures toast
- Cron `%` error explains crontab newlines; merge comments do not pile up; `cron status`.lastInstall follows last install
- `dns health` does not treat systemd-resolved `127.0.0.53` as a product nameserver
- `projects backup` updates `backup status`.lastRun; tarball excludes `.env` / `.db.env` and notes no SQL dump
- Postfix apply sets `virtual_mailbox_domains` and keeps the apex out of `mydestination`; Dovecot is not pointed at missing LE files
- Public files can turn autoindex off; hostname is a link; root terminal asks before opening a PTY
- Nginx catch-all owns `:80`/`:443 default_server` (unknown SNI is not hello); other `default_server` flags and leftover `ysk-*` / old `public-files-*` vhosts are removed
- Apache PHP backend stays on `127.0.0.1:8080`; stock `000-default` is disabled so `php.*` is not “It works”
- Security 「允許清單」 tab is labelled 工具權限 / Agent tools (`?tab=allowlist` still works)

## 1.0.35 — 2026-08-15

### Fix
- Role-policy editor asks before discarding unsaved capability edits; Save is disabled when clean
- Package quota chips use GiB labels; negative values are rejected
- Account security can change the sign-in password; Strict 2FA cannot lock the last unenrolled admin
- API keys stay named API (not 「介面」); default scope is read
- SSH public keys must be a real OpenSSH line; Strict apply stays off until PAM is ready
- VNC XFCE / viewer install banners list only their own packages
- journald vacuum copy is readable; Real IP CDN refresh needs a provider
- Host-browse iframe content is token-auth (not Bearer), so proxy pages render instead of “refused to connect”
- Bookmarks have a list drawer; no-sandbox / dangerous downloads need confirm
- VNC client / settings warn when noVNC or TigerVNC is missing

## 1.0.34 — 2026-08-15

### Fix
- fail2ban stop uses the shared lifecycle bar with confirm; ignoreip rejects `999.999.999.999`
- Let's Encrypt certificates show **issued**, not uploaded
- System cron jobs can be created without a project; invalid cron expressions are rejected
- Updates current/latest versions follow the live probe; same-version rows no longer draw `X → X`
- Kernel apply confirm mentions reboot; jail descriptions follow the UI language
- Isolation form no longer pretends 512M limits are already applied; bash needs confirm
- Remote backup fields disable when remote push is off
- `?tab=self` / `?tab=disk` rewrite to the real tab
- fail2ban banner no longer prints `UFW = UFW =`

## 1.0.33 — 2026-08-14

### Fix
- New-folder names cannot contain `/` or `\\` (UI + API `leafOnly`)
- `/services` cannot restart/stop missing units; start is not offered while running
- Cron copy no longer claims the cron daemon is missing when only the panel crontab is unsynced
- Updates page current version follows the live self-update probe; high-risk counts use the same inventory
- Email health probe stays on the health tab; relay host is required; hourly cap rejects negatives
- Recycle-bin header count refreshes after delete; folder rows open on row click
- journalctl is not machine-translated to 「系統日誌ctl」
- Toasts sit below page tabs; firewall/fail2ban banners no longer say 「fail2ban = fail2ban =」

## 1.0.32 — 2026-08-14

### Fix
- Create-project / wizard runtime chips are real buttons; dialogs portal to `document.body` so a click no longer dismisses the modal
- Global search always matches panel pages locally (備份 / backup / mysql) even if the API is empty
- MariaDB page lists control-plane databases tagged `mysql` (exclusive engine pool); wizard tags the live engine
- Node probe no longer treats `v24.19.0` as major 19
- Dashboard no longer leaks `執行{{狀態}}`; PM2 is not 「顆粒物」; WireGuard peer placeholder is not 「電話」
- Feature portal lists every sidebar feature (no silent 16-card cut)
- Notification tab badge is the notification count only (apply-audit stays on its own chip)
- Firewall-off / undecided exposure no longer claims 「公網開放」
- Let's Encrypt certificates stay **issued**, not uploaded; Nginx SSL column follows cert/conf
- Redis RDB filename presets no longer include `appendonly.aof`
- Empty recycle bin cannot run empty-trash; public-files 「開啟網站」 is disabled until live
- MySQL / MariaDB pages have a real one-click install banner
- `?tab=shadowsocks` / `?tab=plans` / `?tab=perm` deep links work

## 1.0.31 — 2026-08-14

### Fix
- Login no longer flashes the raw `product` key; language can be switched before sign-in
- Empty trash / permanent purge ask for confirmation
- Public files no longer default to `files.` or link to `http://files./`
- Search matches Chinese nav names; stale results are not used for Enter
- Dashboard UFW chip follows `ufw status` (not just the systemd unit)
- MySQL page on a MariaDB host no longer shows a MariaDB client version as MySQL
- Exposure strip defaults to private, not public
- PHP header pill uses the host version, not php.net latest
- Service console presets are per-engine (no more 3306/5432/6379 on every port field)
- Kernel/linux-image apply requires confirm
- Readiness export actually downloads
- Toast sits below the header
- Brand names stay English (WireGuard, InnoDB, RDB, Let's Encrypt, SSE, journalctl)

## 1.0.30 — 2026-08-14

### Change
- Product requires **Node.js 22+**. Official install upgrades Node 20 hosts to current LTS (**24.x**) instead of pinning older plugins
- WebTorrent stays on **3.x**; global pnpm is **latest** (11) once Node meets the floor

## 1.0.29 — 2026-08-14

### Fix
- Node 20 hosts no longer get `EBADENGINE` for Node 22-only packages: pin WebTorrent to 2.8.5; drop unused `better-sqlite3` 13 (SQLite is sql.js)

## 1.0.28 — 2026-08-14

### Fix
- Optional apt uses `--no-remove` so Ubuntu `mysql-client` cannot purge MariaDB
- SQL client follows the chosen engine (no MySQL client on a MariaDB host)
- Official one-liner: move leftover global `ysk-server` aside before `npm install -g` (ENOTEMPTY + `node-gyp-build: not found`). If npm still fails, overlay the running tree instead of exiting 1

## 1.0.27 — 2026-08-14

### Fix
- Official one-liner verify no longer fails on Ubuntu PostgreSQL: `postgres` lives at `/usr/lib/postgresql/*/bin/postgres`, not on `PATH`

## 1.0.26 — 2026-08-14

### Fix
- Official one-liner: do not use `--ignore-scripts` (that left `@simplewebauthn/server` empty; setup and `ysk-server --version` crashed)
- Stub `npx only-allow` so `ip-set` cannot abort npm, then extract packages fully
- Repair an empty `@simplewebauthn/server` from a 1.0.25 install
- Load the WebAuthn library only when a passkey call runs
- Replace pnpm 11 already on PATH (needs Node 22) with pnpm 9

## 1.0.25 — 2026-08-14

### Fix
- Official `install.sh` one-liner: `npm install -g ysk-server` no longer dies on `ip-set` `only-allow` (skip lifecycle scripts, then rebuild native addons)
- Global pnpm pinned to 9.x so Node 20 hosts are not asked for Node 22

## 1.0.24 — 2026-08-14

### Fix
- RequireCapability shows a no-access page (CI guard test aligned)

### Docs
- API / CLI / install / uninstall / VNC / users / security / files / user-manual: public VNC share, login body cap, share password header, last-admin lock, install password honesty (EN + 香港書面語)

## 1.0.23 — 2026-08-14

### Fix
- Public VNC share sessions no longer require panel login
- Login JSON body is size-capped; bad JSON returns 400
- `uninstall.sh` refuses a non-HTTPS `YSK_INSTALL_RAW`
- Corrupt SMTP relay settings no longer 500 the dashboard
- Public torrent download is sandboxed to the data directory
- Re-running install no longer prints a password that was not applied
- First-login `mustChangePassword` has a change-password form
- Terminal POST accepts `settings.system` or `services.control`
- PHP-FPM lifecycle follows the installed matrix unit
- Password-protected BT shares unlock via `X-Share-Password` (no query leak)
- VNC share API returns `/vnc-share/:token`; guest Close does not send `/login`
- Auth redirect keeps the original query string
- Project Java / Kotlin / Bun filters, GET-by-id details, and tab aliases work
- SMTP relay form loads saved settings instead of `smtp.example.com`

### Safety
- Confirm stop/restart on DB console and the services matrix (typed confirm for sshd / panel)
- Confirm before disabling UFW
- Cannot delete, suspend, or demote the signed-in user or the last admin

### Docs
- npm setup documents `--admin-password`; prefer `install.sh`
- setup docs use `--admin-user` and `/var/lib/ysk-server`

## 1.0.22 — 2026-08-14

### Feature
- Every host service page has stop: vsftpd, Nginx, Apache, Postfix, Dovecot, OpenDKIM, PowerDNS, PHP-FPM, VPN servers, sshd, YSK Server
- Service matrix catalog includes Apache, PowerDNS, OpenDKIM, sshd, and VPN units
- VPN: `ysk-server vpn stop --engine … --execute` (panel + API)

## 1.0.21 — 2026-08-13

### UI
- One toast stack (top-right) for operation results; live jobs stream in the bottom-right dock (minimizable, multi-job)
- Runtime / Updates / deploy logs no longer sit in the page body

## 1.0.20 — 2026-08-13

### UI
- Do not flash English on 繁體中文: boot loads `search` + `updates`; shell waits for the full catalog
- Updates header buttons no longer all show 「處理中」during the first inventory fetch
- Apply toast never shows `npm notice` tarball listings (escape hatch: `install.sh --upgrade`)

## 1.0.19 — 2026-08-13

### Fix
- Managed Nginx apply returns `ok: false` on empty/invalid `serverName` (no uncaught throw; no `localhost` fallback). Restores CI `branch-floor80`.
- `GET /system/software/upgrades` is a read probe: `apt-cache policy` is not blocked by EXECUTE just because the package list includes `ufw`.

### i18n
- English catalog no longer contains leaked Chinese email strings
- zh-HK leftover spoken Cantonese converted to Hong Kong written Chinese
- Filled remaining operator-facing UI strings in ja/ko/es/fr/pt/id/hi/bn/ar/ur

### Docs
- CLI / API / user-manual: Nginx `server_name` fail-closed
- Chinese docs: spoken Cantonese → 香港書面語

## 1.0.18 — 2026-08-13

### Fix
- Nginx proxy render fails closed on empty/invalid `serverName` (CI `nginx-ssl.depth` green)

### i18n
- Filled leftover English leaves in ja/ko/es/fr/pt/id/hi/bn/ar/ur; product names stay English
- zh-HK glossary remains Hong Kong written Chinese

### Docs
- CLI / API / install-update / user-manual: panel overlay apply, `install.sh --upgrade`, no `npm i -g`

## 1.0.17 — 2026-08-13

### UI
- Mobile drawer: language / account / logout sit at the bottom as a compact dock (nav stays on top)

## 1.0.16 — 2026-08-13

### Install
- `install.sh --upgrade` overlays the panel only (no apt stack). Do not reinstall MariaDB over a live MySQL 8 `/var/lib/mysql`
- Full install skips MariaDB if the host already has MySQL (and the reverse)
- `--upgrade-stack` is the explicit “also refresh apt packages” flag
- `--upgrade` overlays first; `npm install -g --force` is best-effort (Hermes/n prefixes used to abort on EEXIST)
- Installer arrays are `declare -g` so `curl|bash --upgrade` no longer dies on `HARD_FAILURES: unbound variable`

### Fix
- Self-update no longer runs `npm install -g` (that dumped `npm notice` tarball listings into the toast and often failed after the dest was already copied)
- Apply errors strip `npm notice` noise and keep the real failure
- If dest `version.js` already contains the target version, apply is treated as success and the unit is restarted
- Failed apply notes include `install.sh --upgrade` as the honest escape hatch

## 1.0.15 — 2026-08-13

### UI
- DataTable is one layout everywhere: desktop keeps a real table; ≤720px is a list of cards (title wraps, facts wrap) plus a ⋯ menu for row actions
- Files shares / browse / trash, Updates, CDN, Support, and Metrics process lists use the same primitive (no per-page table hacks)

## 1.0.14 — 2026-08-13

### Fix
- SPA CSP allows `blob:` for `media-src` / `frame-src` so Files video/audio/PDF preview is not blocked

## 1.0.13 — 2026-08-13

### UI
- Mobile header is menu + search only (account/language/logout in the drawer)
- Files on narrow screens: space/view pickers, compact one-line rows, ⋯ overflow menu (no stacked action cards)

## 1.0.12 — 2026-08-13

### Fix
- Panel no longer stays on boot i18n namespaces: full `translation.json` loads after first paint so pages stop showing raw keys (`readiness.*`, `systemd.*`, …)

## 1.0.11 — 2026-08-13

### Panel self-update
- 「套用面板更新」writes the official npm tarball onto the **running** install (`apps/server` or `ysk-server/`), then restarts `ysk-server.service`
- No longer depends on `npm install -g` (that path never updates from-source ExecStart)
- Overlay does not require `YSK_EXECUTE` (authenticated admin, own package files); default systemd unit now sets `Environment=YSK_EXECUTE=1` so other host applies work
- Apply 422 returns `blockMessage` / `message` as the real failure — never the npm-channel probe line
- `install.sh` overlays the running tree and patches EXECUTE onto existing units

## 1.0.10 — 2026-08-13

### Security
- A08-22–A08-29 after the 1.0.8 live audit deep-dive
- LLM outbound: hostname-only loopback; `GET /settings/llm` masks `apiKey` and requires `settings.system`
- Public Autoconfig/Autodiscover: domain/email allowlist + XML escape
- Nginx and Apache `server_name` / `ServerName` token allowlist
- Central GET inventory gate (`GET_ROUTE_CAP_RULES`) for email, projects, SSL, backups, DNS, CDN, logs, users, fleet, host-browse
- SSH identity and fleet list/history GETs require a matching read/control cap
- Fleet enroll `timingSafeEqual`; boot splash HTML-escapes errors

## 1.0.9 — 2026-08-13

### Security
- Live audit remediations (A08-1–A08-21): public health/readiness subset, TOTP enroll enforced, backup SSRF, fail-closed bash probes
- Host Browse `chromePath` allowlist; VNC IMDS blocked; public VNC share rate-limited
- OpenVPN hooks stripped again on client up; VPN `listenPort` coerced before shell use
- FTP jail under dataDir/project home; impersonate cannot target admin
- DB/Redis console GET requires write/control cap; WebDAV PROPFIND/PUT capped
- Zip-slip / mapped IMDS / IPv6 metadata aliases closed

## 1.0.8 — 2026-08-13

### Control plane
- Wave A: system fonts (no runtime CDN), boot i18n, mobile-friendly shell
- `projects create --create-dns --create-mail` matches panel checkboxes and API `createDnsZone` / `createMailDomain`
- Project FTP: CLI `projects ftp` / `ftp accounts create --project` matches `POST /api/v1/projects/:id/ftp`; panel `/ftp?project=`
- Email vacation / catch-all: CLI `email flags` matches panel aliases + `PATCH /email/domains/:id/flags`
- Mail queue: parsed sender/recipients table on `/email?tab=queue`; list is a read probe (flush still needs EXECUTE)
- Dashboard notification bar + CLI `ysk-server notifications` (`GET /api/v1/notifications`)
- Remote backup: `backup settings test` / `POST /api/v1/backups/remote/test` probes SFTP/S3/local (EXECUTE for live connect)
- Per-domain antispam: CLI `email policy` matches panel + `POST /email/domains/:id/policy`
- Panel-user 2FA: `requireUserTotp` + CLI `users totp` / `users totp-clear`
- Feature matrix sealed against shipped Waves A–C (no remaining P0 ✗)

## 1.0.7 — 2026-08-13

### Control plane
- CLI `files --if-exists` matches panel/API name-collision policy (default fail)
- CLI `updates hub` matches panel `/updates` `collectUpdateHub` entries
- Three-way inventory gate: `node scripts/cli-panel-parity.mjs --strict`

## 1.0.6 — 2026-08-13

### Files
- Desktop-style name conflict on drop, copy, move, and rename (skip / keep both / replace / merge folders / apply to all)

## 1.0.0 — 2026-08-12

### CI
- Gates green: Support page uses DataTable; chrome skip for embed/redirect/public panels; css:reuse utilities; docs bilingual fence-aware headings
- `probe:ssot` moved to soft CI job (known raw `command -v` debt outside software-probe) — hard `pnpm gates` no longer includes it

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
- **stack core + CLI + API + Web**: `ysk-server-core` `hosting/stack/*`; `ysk-server stack plans|status|scan|expand|install|uninstall`; REST `/api/v1/system/stack/*`; Services page **Stack** tab wizard
- **software probe**: `binExists` expands PATH + absolute sbin/bin paths; mysql-client accepts `mysql`|`mariadb`, mariadb-server accepts `mariadbd`|`mysqld`

## 0.1.0 (in progress — honest status)

Production-oriented control plane with **real** Node/PHP listen paths, durable JSON store,
Web UI served from `serve`, and fail-closed host mutations (`YSK_EXECUTE`).

### Wave 2 — architecture · honesty · unification (2026-07-30)

Full-system coding review stack **R0–R7** (see [docs/architecture/code-review-wave2.md](./docs/architecture/code-review-wave2.md)).

**Architecture & contracts**

- `ysk-server-shared` domain DTO modules: metrics, network, system, databases, ftp, files, email-domain, fleet, software, ssl, updates, ai — web `features/*/api.ts` re-exports; core metrics/readiness/host overview align
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

- Monorepo: `ysk-server-shared`, `ysk-server-core`, `ysk-server`, `ysk-server-web`
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
