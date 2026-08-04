# Install

> Language: English | [中文](./install-ZH.md)

Install **YSK Server** (control plane CLI `ysk-server`) and **selected host software bundles** (web, databases, mail, DNS, FTP, defense, runtimes).

| Item | Value |
|------|--------|
| Script | [`install.sh`](../../install.sh) |
| Uninstall | [`uninstall.sh`](../../uninstall.sh) · [uninstall.md](./uninstall.md) |
| Stack definitions | [`deploy/stack/bundles.json`](../../deploy/stack/bundles.json), [`components.json`](../../deploy/stack/components.json) |
| Target OS | **Ubuntu 22.04 / 24.04** (Debian best-effort) |
| Node.js | **20+** (NodeSource if missing) |
| Default plan | **`recommended`** (not full stack) |

**Honesty:** packages are installed; **most services are not force-enabled**. Live apply still needs **root** + **`YSK_EXECUTE=1`**. See [../architecture/ops-honesty.md](../architecture/ops-honesty.md).

**Logs:** `/var/log/ysk-server/install-*.log` (root) or `~/.ysk/logs/`.  
**Manifest:** `$dataDir/stack-manifest.json` (what was installed — used by uninstall).

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
6. **systemd** — optional unit write
7. **Confirm summary** → install → verify selected components only → save manifest

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
| `web` | nginx, apache2 (optional), certbot, PHP |
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
| `--install-systemd` | Write unit after setup |
| `--data-dir PATH` | Panel data + manifest location |
| `--skip-setup` | Packages + product only |
| `--upgrade` | Reinstall npm `ysk-server` |
| `--full` / `--minimal` | Aliases for `--plan full` / `--plan minimal` |
| `--skip-runtimes` | Drop `runtimes` from the selection |

---

## Verify + logs

After install, only **selected** component binaries are verified (hard-fail if missing). Optional packages (rspamd, multi-PHP minors, …) may warn-and-continue.

On failure: log path, phase name, and last 40 log lines are printed.

---

## Uninstall

```bash
sudo ./uninstall.sh
sudo ./uninstall.sh --bundles email --keep-data --yes
```

See [uninstall.md](./uninstall.md) — partial/full removal, **keep-data** vs **purge-data**.

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

1. `$CLI setup --non-interactive --data-dir /var/lib/ysk-server`
2. `$CLI readiness --json`
3. `$CLI serve --data-dir /var/lib/ysk-server --port 9287`
4. Open Web UI → login → enable 2FA  
5. Host mutations: `export YSK_EXECUTE=1`
