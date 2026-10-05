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

## What's new in 1.1.27

### Security
- Vitest 4.1.11 and Vite 6.4.3 clear the dev-server advisories. Overrides pin patched `brace-expansion`, `nanoid`, and `ip-address`. `install.sh` pins `pnpm@9.15.9` and `node-gyp-build@4.8.4`.

### Fixes
- Install finish banner reports the installed version, not a frozen `1.0.31`.
- JsonStore keeps another process's rows when the filesystem timestamp does not move between writes.

### Improvements
- Ubuntu **22.04 / 24.04 / 26.04** are the documented install targets.

### Dependency upgrades
- Minor bumps: `ws`, `playwright-core`, `maxmind`, `sql.js`, `tsx`, `react-router-dom`, TypeScript 5.9.

### Internal & CI
- Tag push publishes with npm Trusted Publishing. This page keeps the latest three versions.
- `ysk-server`, `ysk-server-shared`, and `ysk-server-core` ship **1.1.27**.

## What's new in 1.1.26

### New features
- Validators: NEAR form fills `create_staking_pool` and writes `account_id` only. Cosmos form fills gaiad v28 `validator.json`. ETH shows a Lighthouse VC example or the beacon URL.

### Fixes
- Honest ADA / AVAX / Solana copy. NEAR confirm shows the real account. Cosmos amount accepts `1atom`.

### Dependency upgrades
- `ysk-server`, `ysk-server-shared`, and `ysk-server-core` ship **1.1.26**.

## What's new in 1.1.25

### New features
- Cron: in-place host crontab edit; `cron update` for managed jobs. Validators: staking next steps and CLI `checklist` / `rewrite-compose` / `compose-write` / `software` / `pull` / `leftover-remove` / `stats`.

### Improvements
- Operator strings and About-tab guides for 13 languages. zh-HK stays Hong Kong written Chinese.

### Fixes
- Host P2P in `public_addr`. Cosmos gas matches the node.

### Dependency upgrades
- `ysk-server`, `ysk-server-shared`, and `ysk-server-core` ship **1.1.25**.

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
| [ysk-server-shared](https://www.npmjs.com/package/ysk-server-shared) | Types and locales (1.1.27) |
| [ysk-server-core](https://www.npmjs.com/package/ysk-server-core) | Hosting and security core (1.1.27) |

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
