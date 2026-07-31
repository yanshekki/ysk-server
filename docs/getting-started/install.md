# Install

> Language: English | [中文](./install-ZH.md)

Install **YSK Server** (control plane + hosting panel CLI `ysk-server`) and, by default, the **full system software stack** the panel and CLI may use (web, mail, databases, DNS, FTP, defense, language runtimes).

| Item | Value |
|------|--------|
| Script | [`install.sh`](../../install.sh) at repository root |
| Target OS | **Ubuntu 22.04 / 24.04** (Debian best-effort) |
| Node.js | **20+** (LTS via NodeSource if missing) |
| Product package | `ysk-server` on npm, or monorepo `--from-source` |
| Default mode | **Full stack** (not control-plane-only) |

**Honesty:** packages are installed onto the host; **most services are not force-enabled**. Configuration and live apply still go through the panel/CLI with **root** + **`YSK_EXECUTE=1`**. `written` ≠ `applied` until you execute. See [../architecture/ops-honesty.md](../architecture/ops-honesty.md).

---

## One-click (recommended on a clean VPS)

Requires root or passwordless/`sudo` for `apt` and NodeSource.

```bash
# Full stack (default): base + hosting/mail/DB/DNS/FTP/defense + PHP/Python/Go/Rust tools + Node + ysk-server
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash
```

Non-interactive (CI / cloud-init):

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive
```

From a git checkout:

```bash
git clone https://github.com/yanshekki/ysk-server.git
cd ysk-server
sudo ./install.sh --non-interactive
# Development build from this tree:
./install.sh --from-source --non-interactive
# Optional: write systemd unit after setup
./install.sh --from-source --install-systemd --non-interactive
```

---

## Installer flags

| Flag | Meaning |
|------|---------|
| *(default)* / `--full` | Install **all** system packages the product may use |
| `--minimal` | Only base deps + Node + product (no nginx/mail/DB/DNS/FTP stack) |
| `--skip-runtimes` | Skip PHP / Python extras / Go / Rust / pm2 path (Node still installed) |
| `--with-mysql-server` | Install **mysql-server** instead of **mariadb-server** |
| `--with-clamav` | Also install ClamAV (large; off by default) |
| `--non-interactive` | No prompts; setup uses `--force` when setup runs |
| `--skip-setup` | Install packages + product only; do not run `ysk-server setup` |
| `--upgrade` | Reinstall / upgrade the npm `ysk-server` package |
| `--from-source` | `pnpm install && pnpm build` in the current repo; CLI wrapper to `dist/cli.js` |
| `--install-systemd` | After setup, write (and enable if root + `YSK_EXECUTE=1`) the control-plane unit |
| `-h` / `--help` | Show usage |

Examples:

```bash
# Control plane only (tiny VPS / already have your own stack)
./install.sh --minimal --non-interactive

# Full stack but no PHP/Go/Rust toolchain
./install.sh --full --skip-runtimes

# Oracle MySQL + ClamAV on top of full stack
sudo ./install.sh --with-mysql-server --with-clamav --non-interactive
```

---

## What gets installed (full mode)

Phases run in order: **base → hosting stack → runtimes → Node → global npm tools → product → setup → optional systemd**.

### 1. Base system

`curl`, `git`, `ca-certificates`, `build-essential`, `gnupg`, `software-properties-common`, `apt-transport-https`, `openssl`, `jq`, `unzip`/`zip`, `rsync`, `tar`, `cron`, `logrotate`, `htop`, `net-tools`, `iproute2`, `dnsutils`, `whois`, `lsof`, `procps`, `sudo`, `acl`, `attr`.

### 2. Hosting / mail / DB / DNS / FTP / defense

| Group | Packages (representative) |
|-------|---------------------------|
| Web + SSL | `nginx`, `apache2`, `certbot`, `python3-certbot-nginx` (+ soft `python3-certbot-apache`) |
| Databases | `postgresql` + client, `redis-server` + tools, `sqlite3`; default **MariaDB** server+client (or **MySQL** with `--with-mysql-server`) |
| Mail | `postfix` (preseeded “No configuration”), `dovecot-core` / imapd / pop3d / lmtpd, `opendkim` + tools; soft `rspamd`; optional `clamav` / `clamav-daemon` |
| DNS | `pdns-server`, `pdns-backend-bind`; soft `bind9-dnsutils` |
| FTP | `vsftpd`, `db-util`, `libpam-modules` |
| Defense | `ufw`, `fail2ban` |
| Backup / quota | soft `restic`, `quota` |

**Soft packages:** if apt cannot find a package on this distro/release, the installer logs a warning and **continues** (does not abort the whole run).

### 3. Language runtimes (unless `--skip-runtimes` or `--minimal`)

- PHP: generic `php` + common modules / FPM, plus versioned soft installs for 8.1 / 8.2 / 8.3 where available  
- Python 3 + `pip` + `venv`  
- Go (`golang-go`, soft)  
- Rust via **rustup** (non-interactive `-y`) if `cargo`/`rustc` missing  

### 4. Node.js + globals

- Node.js **20.x** via NodeSource if missing or too old  
- Global **pnpm** and **pm2** via npm  

### 5. Product

| Mode | Behavior |
|------|----------|
| Default (npm) | `npm install -g ysk-server@latest` |
| `--from-source` | `pnpm install` + `pnpm build`, embed Web UI into `apps/server/public/web` when built, install CLI wrapper (`/usr/local/bin/ysk-server` or `~/.local/bin`) |
| `--upgrade` | Re-run global npm install of the package |

Unless `--skip-setup`, runs `ysk-server setup --non-interactive` (adds `--force` when `--non-interactive`).

---

## Monorepo development (without install.sh)

```bash
git clone https://github.com/yanshekki/ysk-server.git
cd ysk-server
# Node 20+ and pnpm required
pnpm install
pnpm build
pnpm --filter @ysk/web build   # embed UI if you serve from apps/server
pnpm --filter @ysk/server exec node --import tsx/esm src/cli.ts setup --data-dir .ysk --json
pnpm --filter @ysk/server exec node --import tsx/esm src/cli.ts serve --data-dir .ysk
# Open http://127.0.0.1:9287/
```

Or use the installer against the checkout:

```bash
./install.sh --from-source --minimal   # or --full on a real host
```

---

## After install — next steps

```bash
# 1) Explicit data dir (production)
ysk-server setup --non-interactive --data-dir /var/lib/ysk-server
# Optional strong admin password on first setup:
# YSK_ADMIN_PASSWORD='…' ysk-server setup …

# 2) Honesty / readiness
ysk-server readiness --data-dir /var/lib/ysk-server --json

# 3) Run control plane
ysk-server serve --data-dir /var/lib/ysk-server --port 9287
# or systemd (mutations need EXECUTE + usually root):
# YSK_EXECUTE=1 sudo -E ysk-server system unit-install --enable --data-dir /var/lib/ysk-server

# 4) Open Web UI → login → enable 2FA → create project → deploy

# 5) Host mutations (firewall apply, nginx live, package plans, …)
export YSK_EXECUTE=1
# run CLI as root when the host requires it
```

Useful commands:

```bash
ysk-server --help
ysk-server readiness --json
ysk-server serve --data-dir .ysk --port 9287
ysk-server update --check
```

Environment:

| Variable | Role |
|----------|------|
| `YSK_EXECUTE=1` | Allow system mutations (apt apply plans, ufw, service reloads, …) |
| `YSK_ADMIN_PASSWORD` | Initial admin password on first setup |
| `YSK_DATA_DIR` | Default data directory hint for some paths |
| `YSK_LOCALE` | `zh-HK` / `zh-CN` / `en` |

---

## What install does **not** do

- Does **not** claim mail is deliverable to Gmail/Outlook (PTR, port 25, DNSBL remain external).  
- Does **not** auto-open firewall ports or enable every daemon — configure via panel/CLI.  
- Does **not** replace [setup.md](./setup.md), [readiness.md](./readiness.md), or [go-live.md](./go-live.md).  
- Does **not** install multi-node HA peers or cloud DNS registrar accounts for you.

---

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| `apt-get not found` | Use Ubuntu/Debian; the script is apt-based |
| Soft package “unavailable” | Distro package name differs; install manually or ignore if unused |
| `ysk-server: command not found` | Ensure `/usr/local/bin` or `~/.local/bin` on `PATH`; or use `npx ysk-server` / monorepo `dist/cli.js` |
| Node too old | Re-run installer or install Node 20+ yourself |
| Setup already exists | Use `--skip-setup` or setup with existing `--data-dir` |
| Need to re-apply stack packages only | Re-run `./install.sh --skip-setup` (or `--upgrade` for the npm package) |
| Mutations “succeed” but nothing live | Set `YSK_EXECUTE=1` and run as root; check [../deploy/root-execute.md](../deploy/root-execute.md) |

Verify script syntax locally:

```bash
bash -n install.sh
./install.sh --help
```

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [setup.md](./setup.md) | First-time `setup` / dataDir / admin |
| [readiness.md](./readiness.md) | Readiness probe |
| [go-live.md](./go-live.md) | Production checklist |
| [../deploy/systemd.md](../deploy/systemd.md) | Control-plane unit |
| [../deploy/root-execute.md](../deploy/root-execute.md) | root + `YSK_EXECUTE` |
| [../features/runtimes.md](../features/runtimes.md) | Runtime install via panel/CLI |
| [../architecture/ops-honesty.md](../architecture/ops-honesty.md) | written ≠ applied |
| [../INDEX.md](../INDEX.md) | Full documentation index |
