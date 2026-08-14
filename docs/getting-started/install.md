# Install

> Language: English | [中文](./install-ZH.md)

Install **YSK Server** (control plane CLI `ysk-server`) and **selected host software bundles** (web, databases, mail, DNS, FTP, defense, runtimes).

| Item | Value |
|------|--------|
| Script | [`install.sh`](../../install.sh) |
| Uninstall | [`uninstall.sh`](../../uninstall.sh) · [uninstall.md](./uninstall.md) |
| Stack definitions | [`deploy/stack/bundles.json`](../../deploy/stack/bundles.json), [`components.json`](../../deploy/stack/components.json) |
| Target OS | **Ubuntu 22.04 / 24.04** (Debian best-effort) |
| Node.js | **20+** (NodeSource if missing). Do not require Node 22. |
| Default plan | **`recommended`** (not full stack) |

**Honesty:** packages are installed; **most services are not force-enabled**. Live apply still needs **root** + **`YSK_EXECUTE=1`**. See [../architecture/ops-honesty.md](../architecture/ops-honesty.md).

`npm install -g ysk-server` skips dependency lifecycle scripts (`ip-set@3` runs `npx only-allow pnpm` and aborts a stock Ubuntu 24 / Node 20 host), then rebuilds native addons (`node-pty`, `better-sqlite3`). Global **pnpm** is pinned to **9.x** — `pnpm@latest` (11) needs Node 22.

**Logs:** `/var/log/ysk-server/install-*.log` (root) or `~/.ysk/logs/`.  
**Manifest:** `$dataDir/stack-manifest.json` (what was installed — used by uninstall).

### HTTPS bootstrap (first login by IP)

By default, install:

1. Runs `ysk-server setup` with **`listenHost=0.0.0.0`**
2. Runs **`ysk-server ssl bootstrap`** — self-signed cert under `$dataDir/ssl/panel/` (SAN includes `127.0.0.1`, detected host IP, `localhost`)
3. Sets **`tlsEnabled` + `tlsHttpsOnly`** — panel is **HTTPS-only** on port **9287**

Open: `https://<server-ip>:9287` and **accept the browser warning** (self-signed).  
Later replace with Let's Encrypt when you have a domain (panel SSL settings).

| Flag | Meaning |
|------|---------|
| `--bootstrap-tls` | Default: generate bootstrap cert |
| `--no-bootstrap-tls` | Lab only — skip TLS (insecure HTTP) |
| `--tls-san 1.2.3.4,5.6.7.8` | Extra IPs on the bootstrap cert |
| `--listen-host 0.0.0.0` | Override bind address |

CLI (re-run anytime):

```bash
ysk-server ssl bootstrap --data-dir /var/lib/ysk-server --force
# Root install enables systemd by default:
systemctl status ysk-server
# Manual serve (if --no-install-systemd):
ysk-server serve --data-dir /var/lib/ysk-server --port 9287
```

After install, open the panel URL printed on the console, log in with credentials in `$dataDir/BOOTSTRAP-CREDENTIALS.txt`, then change password and enable 2FA. Support: **email@ysk.hk** · panel `/support`.

Re-running install when `$dataDir/config.json` already exists does **not** rotate the admin password or print a new one (unless you pass `--admin-password`). Use the existing account.

---

## Interactive wizard (recommended on a VPS)

```bash
git clone https://github.com/yanshekki/ysk-server.git
cd ysk-server
sudo ./install.sh
```

Steps:

1. **Plan** — recommended / full / minimal / **custom multi-select bundles**
2. **SQL** (if database) — MariaDB (default) **or** MySQL (exclusive)
3. **ClamAV** (if email) — optional large package
4. **Product source** — npm global or `--from-source`
5. **Data directory** — default `/var/lib/ysk-server` (root) or `~/.ysk`
6. **systemd** — **recommended default ON as root** (enable + start panel)
7. **Confirm summary** → install → verify → save manifest → print login credentials

---

## One-liner / non-interactive

```bash
# Default non-interactive plan = recommended
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive

# Full stack (all bundles)
curl -fsSL …/install.sh | bash -s -- --non-interactive --plan full

# Custom bundles
./install.sh --non-interactive --bundles control-plane,web,defense
```

When stdin is not a TTY (typical `curl|bash`), the installer runs **non-interactive** with plan **`recommended`** unless you pass `--plan` / `--bundles`.

### Upgrade the panel only (do not reinstall SQL)

`--upgrade` overlays the official npm tarball onto the **running** `ExecStart` tree and restarts `ysk-server`. It does **not** apt-install MariaDB/MySQL. Use this when the panel “套用面板更新” button cannot self-heal.

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --upgrade
```

If the host already has **MySQL 8** data in `/var/lib/mysql`, never run `--upgrade-stack` / `--plan recommended` expecting MariaDB — that dpkg preinst tries to rename the data dir and fails.

---

## Plans

| Plan | Bundles |
|------|---------|
| `minimal` | `control-plane` only |
| `recommended` (default) | `control-plane` + `web` + `database` + `defense` |
| `full` | all: web, database, email, dns, ftp, defense, runtimes |
| `custom` | whatever you pass via `--bundles` or wizard multi-select |

### Bundle catalogue

| Bundle | Contents (summary) |
|--------|-------------------|
| `control-plane` | base tools, git, Node 20+, `ysk-server` product (**always included**) |
| `web` | nginx (:80/:443 edge), apache2 (PHP backend `127.0.0.1:8080`), certbot, PHP |

**MySQL ↔ MariaDB:** exclusive on one host. Panel one-click install opens a confirm dialog (`SWITCH`) that dumps user DBs, uninstalls the other engine, installs the target, then imports. Bare apt install of the other server is refused (`needs_exclusive_switch`).
| `database` | MariaDB **or** MySQL, PostgreSQL, Redis, clients, sqlite |
| `email` | postfix, dovecot, opendkim; optional rspamd / ClamAV |
| `dns` | PowerDNS |
| `ftp` | vsftpd, db-util |
| `defense` | ufw, fail2ban |
| `runtimes` | PHP, Python, Go, Rust |

---

## Flags

| Flag | Meaning |
|------|---------|
| `--plan NAME` | `minimal` / `recommended` / `full` |
| `--bundles LIST` | Comma-separated bundle ids |
| `--non-interactive` | No prompts |
| `--with-mysql-server` | SQL = MySQL instead of MariaDB |
| `--with-clamav` | Add ClamAV when email is selected |
| `--from-source` | `pnpm install && pnpm build` in git checkout |
| `--install-systemd` | Write unit after setup (**default ON as root**) |
| `--no-install-systemd` | Skip unit (manual serve later) |
| `--admin-password PASS` | Initial admin password (default: random strong) |
| `--admin-user NAME` | Initial admin username (default: `admin`) |
| `--data-dir PATH` | Panel data + manifest location |
| `--skip-setup` | Packages + product only |
| `--upgrade` | Overlay latest `ysk-server` onto the **running** install (does **not** reinstall MariaDB/MySQL) |
| `--upgrade-stack` | Also refresh apt stack packages (do not use when MySQL 8 data already lives in `/var/lib/mysql`) |
| `--full` / `--minimal` | Aliases for `--plan full` / `--plan minimal` |
| `--skip-runtimes` | Drop `runtimes` from the selection |

---

## Verify + logs

After install, only **selected** component binaries are verified (hard-fail if missing). Optional packages (rspamd, multi-PHP minors, …) may warn-and-continue.

On failure: log path, phase name, and last 40 log lines are printed.

---

## Uninstall

```bash
# Stack + product CLI/unit; keep data
sudo ./uninstall.sh --all --keep-data --yes
# DANGEROUS: also purge whitelisted data
sudo ./uninstall.sh --all --purge-data --yes
```

`--all` removes the product (CLI + unit) unless `--keep-product`. See [uninstall.md](./uninstall.md).

### CLI (after product is installed)

```bash
ysk-server stack plans --json
ysk-server stack status --data-dir /var/lib/ysk-server --json
ysk-server stack expand --plan recommended --json
# Dry-run (default without YSK_EXECUTE):
ysk-server stack install --plan recommended --data-dir /var/lib/ysk-server --json
# Live:
YSK_EXECUTE=1 sudo ysk-server stack install --yes --plan recommended --data-dir /var/lib/ysk-server
YSK_EXECUTE=1 sudo ysk-server stack uninstall --yes --bundles email --data-dir /var/lib/ysk-server
```

### Web panel

**Services → Stack / 套餐** tab: plan/bundle wizard, dry-run, install, uninstall with keep/purge.

---

## Monorepo development (without full host stack)

```bash
git clone https://github.com/yanshekki/ysk-server.git
cd ysk-server
# Node 20+ and pnpm
pnpm install && pnpm build
./install.sh --from-source --plan minimal --non-interactive
```

---

## Next steps after install

1. Open the printed panel URL **`https://<IP>:9287`** (accept self-signed warning)
2. Login with credentials in **`BOOTSTRAP-CREDENTIALS.txt`** (or printed at install end) → change password → enable 2FA
3. Optional: `$CLI readiness --json`
4. Host mutations: `export YSK_EXECUTE=1` (usually as root)
5. Help / donate: panel **`/support`** · **email@ysk.hk**
