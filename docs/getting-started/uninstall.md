# Uninstall

> Language: English | [中文](./uninstall-ZH.md)

Remove **YSK Server** host stack packages (and optionally the control plane product) in a controlled way.

| Item | Value |
|------|--------|
| Script | [`uninstall.sh`](../../uninstall.sh) at repository root |
| Manifest | `$dataDir/stack-manifest.json` (what YSK installed) |
| Companion | [`install.sh`](../../install.sh) · [install.md](./install.md) |

**Honesty:** uninstall removes **packages / units / optional data paths** recorded for YSK. It does **not** reverse every panel config file unless those paths are in the manifest. Prefer **keep-data** unless you intentionally want DB/mail data deleted.

`YSK_INSTALL_RAW` (remote lib fetch) must be `https://`. Non-HTTPS bases are refused, same as `install.sh`.

---

## Interactive (recommended)

```bash
sudo ./uninstall.sh
```

Wizard steps:

1. **Scope** — all tracked components, by **bundle**, or by **single component**
2. **Data policy** — `keep-data` (default) or `purge-data`
3. **Product** — whether to remove `ysk-server` CLI / systemd unit
4. **Confirm** — purge requires typing `yes`

Logs: `/var/log/ysk-server/uninstall-YYYYMMDD-HHMMSS.log` (root) or `~/.ysk/logs/`.

---

## Non-interactive examples

```bash
# Remove mail stack packages; keep mail spools and DB files
sudo ./uninstall.sh --bundles email --keep-data --yes

# Remove only nginx + certbot packages
sudo ./uninstall.sh --components nginx,certbot --keep-data --yes

# Remove stack + product CLI/unit; keep data dirs
# (--all implies --remove-product unless --keep-product)
sudo ./uninstall.sh --all --keep-data --yes

# DANGEROUS: purge packages + whitelisted data paths + product
sudo ./uninstall.sh --all --purge-data --yes
```

| Flag | Meaning |
|------|---------|
| `--all` | Every component in `stack-manifest.json` **and** product CLI/unit (unless `--keep-product`) |
| `--bundles LIST` | Expand bundle ids → components (skips control-plane base bits) |
| `--components LIST` | Explicit component ids (`nginx`, `mariadb-server`, …) |
| `--keep-data` | `apt remove`; leave data directories (default) |
| `--purge-data` | `apt purge` + delete **whitelisted** data paths only |
| `--remove-product` | npm global `ysk-server`, CLI wrapper, unit; purge may delete `dataDir` |
| `--keep-product` | With `--all`: remove only stack packages; leave CLI/unit |
| `--yes` | Required when `--non-interactive` |
| `--data-dir PATH` | Where to read/write the manifest |

---

## Data policy details

| Policy | Packages | Units | Data paths (`/var/lib/mysql`, …) | Panel `dataDir` |
|--------|----------|-------|----------------------------------|-----------------|
| `keep-data` | `apt remove` | stop/disable | **kept** | kept |
| `purge-data` | `apt purge` | stop/disable | **deleted** if on whitelist | deleted only with `--remove-product` |

**Purge whitelist (safety):** only paths under `/var/*`, `/etc/letsencrypt`, `/usr/local/cargo`, `/usr/local/rustup` as registered for the component. Unexpected paths are refused.

---

## Manifest

Install writes `stack-manifest.json` listing components, apt packages, units, and data paths. Uninstall updates or removes entries. If the file is missing, prefer explicit `--components` / re-install then uninstall, rather than guessing.

---

## Re-install after uninstall

```bash
sudo ./install.sh --plan recommended --non-interactive
# or interactive
sudo ./install.sh
```

See [install.md](./install.md) for plans and bundles.
