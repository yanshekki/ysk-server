<p align="center">
  <img src="https://raw.githubusercontent.com/yanshekki/ysk-server/main/apps/web/public/logo.svg" width="72" alt="YSK Server" />
</p>

<h1 align="center">ysk-server</h1>

<p align="center">
  <strong>The Linux control plane for a host you own.</strong><br />
  CLI <code>ysk-server</code> · HTTP API · embedded web panel.
</p>

<p align="center">
  <a href="https://github.com/yanshekki/ysk-server#readme">GitHub</a>
  ·
  <a href="https://github.com/yanshekki/ysk-server/blob/main/README-ZH.md">中文</a>
  ·
  <a href="https://ysk.hk/">ysk.hk</a>
  ·
  <a href="mailto:email@ysk.hk">email@ysk.hk</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ysk-server"><img alt="npm" src="https://img.shields.io/npm/v/ysk-server.svg?style=flat-square&color=2ea043" /></a>
  <img alt="Node.js 22+" src="https://img.shields.io/badge/node-%3E%3D22-58a6ff?style=flat-square" />
  <img alt="13 locales" src="https://img.shields.io/badge/locales-13-58a6ff?style=flat-square" />
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-2ea043?style=flat-square" />
</p>

Free, open, **single-host**. Install on your VPS or bare metal. The same core drives the panel, the CLI, and the API — including AI agents.

Host writes need **root** + `YSK_EXECUTE=1`. Dry-run never reports success.

## What's new in 1.1.30

### Security
- Weekly supply-chain pass. New high `happy-dom` (GHSA-834v-8h66-3h79) pinned to **21.0.4**. Residual `ip@2.0.1` via `bittorrent-tracker` is unchanged.

### Dependency upgrades
- Vite **6.4.5**, `sql.js` **1.15.1**, happy-dom **21.0.4**. Override: `ip-address` **10.7.5**.

### Internal & CI
- This page keeps the latest three versions.
- `ysk-server`, `ysk-server-shared`, and `ysk-server-core` ship **1.1.30**.

## What's new in 1.1.29

### Security
- Weekly supply-chain pass. Residual `ip@2.0.1` via `bittorrent-tracker` is unchanged.

### Dependency upgrades
- Vitest **4.1.12**, `playwright-core` **1.64.1**, `sql.js` **1.15.0**, `@testing-library/user-event` **14.6.8**.

### Internal & CI
- This page keeps the latest three versions.
- `ysk-server`, `ysk-server-shared`, and `ysk-server-core` ship **1.1.29**.

## What's new in 1.1.28

### Security
- Weekly supply-chain pass. `source-map-js` GHSA-68fv-2mgg-jv7q pinned to **1.2.2**. Residual `ip@2.0.1` via `bittorrent-tracker` is unchanged.

### Dependency upgrades
- Vite **6.4.4**, `playwright-core` **1.64.0**, `happy-dom` **20.14.6**.

### Internal & CI
- This page keeps the latest three versions.
- `ysk-server`, `ysk-server-shared`, and `ysk-server-core` ship **1.1.28**.

[Full changelog](https://github.com/yanshekki/ysk-server/blob/main/CHANGELOG.md)

## Panel

<p align="center">
  <img src="https://raw.githubusercontent.com/yanshekki/ysk-server/main/docs/assets/screenshots/panel-dashboard-en.jpg" alt="YSK Server dashboard" width="920" />
</p>
<p align="center"><sub>Dashboard — live service health, readiness, and apply honesty</sub></p>

<p align="center">
  <img src="https://raw.githubusercontent.com/yanshekki/ysk-server/main/docs/assets/screenshots/panel-system-tools-en.jpg" alt="YSK Server system tools" width="920" />
</p>
<p align="center"><sub>System tools — identity, panel HTTPS, network, and storage</sub></p>

## Install

**Ubuntu 22.04 / 24.04 / 26.04** as **root**. Node.js **≥ 22**. Native deps need `python3`, `make`, and `g++`.

### Fresh host (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive
```

Then open **`https://<server-ip>:9287`**, accept the self-signed warning, and sign in with the one-time password printed by the installer.

### This package

```bash
npm install -g ysk-server
sudo ysk-server setup --admin-user admin --admin-password 'YourStrongPass1!' --data-dir /var/lib/ysk-server
export YSK_EXECUTE=1
sudo ysk-server serve
```

Weak default `admin` is rejected. On a new machine prefer `install.sh` (systemd + TLS + random password).

```bash
ysk-server help
ysk-server readiness --json
```

## Capabilities

| Area | What ships |
|:-----|:-----------|
| **Sites** | Projects, Git deploy, per-site isolation |
| **Files** | File manager, shares, WebDAV, FTPS, BT Tracker / WebTorrent |
| **Mail** | Domains, mailboxes, deliverability checks (inbox reputation is not guaranteed) |
| **Data** | MySQL, MariaDB, PostgreSQL, Redis |
| **Edge** | DNS, SSL, Nginx, Apache, CDN agents |
| **Security** | Protection, SSH / 2FA, VPN, VNC |
| **Containers** | Docker engine |
| **Ops** | Metrics, logs, terminal, cron, backups, updates |
| **Validators** | L1 nodes (Beta) |

## Honesty

- Installing the panel **does not** make global mail inbox delivery a given.
- Dangerous host operations stay **dry-run** until `YSK_EXECUTE=1`.
- First panel certificate is self-signed. Replace it when the host has a domain.

## Package family

| Package | Role |
|:--------|:-----|
| **[ysk-server](https://www.npmjs.com/package/ysk-server)** | **This package** — CLI + API + embedded panel |
| [ysk-server-shared](https://www.npmjs.com/package/ysk-server-shared) | Types and locales (1.1.30) |
| [ysk-server-core](https://www.npmjs.com/package/ysk-server-core) | Hosting and security core (1.1.30) |

`ysk-server` **bundles** shared and core so `npm install -g` is reliable.

Source, docs, and install scripts live on GitHub (not on the npm “Code” tab):

**https://github.com/yanshekki/ysk-server**

[Product README](https://github.com/yanshekki/ysk-server#readme) · [Install guide](https://github.com/yanshekki/ysk-server/blob/main/docs/getting-started/install.md) · [CLI reference](https://github.com/yanshekki/ysk-server/blob/main/docs/cli/reference.md)

## Uninstall

```bash
npm uninstall -g ysk-server
```

If you used `install.sh`:

```bash
sudo ./uninstall.sh --all --keep-data --yes
```

---

<p align="center">
  <strong>YSK Server</strong> · control without a landlord ·
  <a href="https://ysk.hk/">ysk.hk</a> ·
  <a href="mailto:email@ysk.hk">email@ysk.hk</a>
</p>
