<p align="center">
  <img src="apps/web/public/logo.svg" width="72" alt="YSK Server" />
</p>

<h1 align="center">YSK Server</h1>

<p align="center">
  <strong>The Linux control plane for a host you own.</strong><br />
  Web panel, CLI, and API — sites, mail, data, edge, and defense on one VPS or bare metal.
</p>

<p align="center">
  <a href="./README-ZH.md">中文</a>
  ·
  <a href="https://ysk.hk/">ysk.hk</a>
  ·
  <a href="mailto:email@ysk.hk">email@ysk.hk</a>
  ·
  <a href="https://www.npmjs.com/package/ysk-server">npm</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ysk-server"><img alt="npm ysk-server" src="https://img.shields.io/npm/v/ysk-server.svg?style=flat-square&color=2ea043" /></a>
  <a href="https://github.com/yanshekki/ysk-server/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/yanshekki/ysk-server/actions/workflows/ci.yml/badge.svg?style=flat-square" /></a>
  <img alt="Node.js 22+" src="https://img.shields.io/badge/node-%3E%3D22-58a6ff?style=flat-square" />
  <img alt="13 locales" src="https://img.shields.io/badge/locales-13-58a6ff?style=flat-square" />
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-2ea043?style=flat-square" />
</p>

> Language: **English** · [中文（香港書面語）](./README-ZH.md)

Free, open, **single-host**. Not a multi-tenant panel-as-a-service. You install it on your machine; the same core drives the UI, `ysk-server` CLI, and HTTP API — including AI agents.

## Why

| Own the machine | One control plane | Honest apply | Production stack |
|:----------------|:------------------|:-------------|:-----------------|
| One Linux host you operate — VPS or bare metal | Panel, CLI, and API share one model | Host writes need **root** + `YSK_EXECUTE=1`. Dry-run never reports success | Sites, mail, databases, DNS/SSL, defense, Docker |

## What's new in 1.1.8

- **Honest overlay** — dest `package.json` matches the CLI version. Leftover notes no longer claim vsftpd/Dovecot cannot start when they are active.
- **First paint** — backups, validators, and Docker do not flash empty/`0` before data arrives. Docker delete updates the list immediately.
- **E2E-1117** — confirm titles, Nginx cache purge confirm, stuck agent runtimes, host-zone timestamps with `UTC±n`, validator wizard disk copy, `/cluster` engine switcher.

## What's new in 1.1.7

- **Validators** — honest disk (`du` of the validators root), starting vs error, Software tab for pinned images, Avalanche compose flags only.
- **Clocks** follow the host timezone. **FTP** defaults to localhost until FTPS or a typed `PLAINTEXT` public start.
- **Panel self-update** can stream overlay steps; leftover / channel-check notes are not apply errors. E2E-1116: migrate inventory, VNC hosts write, DNS start result, public-files live/draft.

[Full changelog](./CHANGELOG.md)

## Panel

<p align="center">
  <img src="docs/assets/screenshots/panel-dashboard-en.jpg" alt="YSK Server dashboard — service health, readiness, and apply status" width="920" />
</p>
<p align="center"><sub>Dashboard — live service health, readiness, and apply honesty</sub></p>

<p align="center">
  <img src="docs/assets/screenshots/panel-system-tools-en.jpg" alt="YSK Server system tools — identity, panel HTTPS, network, and storage" width="920" />
</p>
<p align="center"><sub>System tools — identity, panel HTTPS, network, and storage</sub></p>

## Install

**Ubuntu 22.04 / 24.04** as **root**. Other Linux: best-effort.

### Recommended

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive
```

`install.sh` writes the systemd unit, bootstrap TLS, and prints a **one-time** admin password.

### After install

1. Open **`https://<server-ip>:9287`** (accept the self-signed warning once).
2. Sign in with the credentials at the end of install (also `$dataDir/BOOTSTRAP-CREDENTIALS.txt`).
3. Change the password. Turn on 2FA.
4. Issue a trusted panel certificate when you have a domain.

### Other ways

```bash
npm install -g ysk-server
sudo ysk-server setup --admin-user admin --admin-password 'YourStrongPass1!' --data-dir /var/lib/ysk-server
export YSK_EXECUTE=1
sudo ysk-server serve
```

Weak default `admin` is rejected. Prefer `install.sh` on a fresh host.

```bash
git clone https://github.com/yanshekki/ysk-server.git
cd ysk-server
sudo ./install.sh
```

### Uninstall

```bash
sudo ./uninstall.sh --all --keep-data --yes
# also wipe registered data:
sudo ./uninstall.sh --all --purge-data --yes
```

Guides: [install](docs/getting-started/install.md) · [uninstall](docs/getting-started/uninstall.md) · [docs index](docs/INDEX.md)

## Capabilities

| Area | What ships |
|:-----|:-----------|
| **Sites** | Projects, Git deploy, per-site isolation |
| **Files** | File manager, public shares, WebDAV, FTPS, BT Tracker / WebTorrent |
| **Mail** | Domains, mailboxes, deliverability checks (inbox reputation is not guaranteed) |
| **Data** | MySQL, MariaDB, PostgreSQL, Redis |
| **Edge** | DNS, SSL, Nginx, Apache, CDN agents |
| **Security** | Protection, SSH / 2FA, VPN, VNC |
| **Containers** | Docker engine |
| **Ops** | Metrics, logs, terminal, cron, backups, updates |
| **Validators** | L1 nodes (Beta) |

## CLI

```bash
ysk-server readiness --json
ysk-server help --locale en
export YSK_EXECUTE=1    # required for real host mutations
```

[CLI reference](docs/cli/reference.md) · [agent commands](docs/agent/commands.json) · [agent skill](.grok/skills/ysk-server/SKILL.md)

## Honesty

- Installing the panel **does not** make global mail inbox delivery a given. DNS, PTR, and port 25 are still yours.
- Dangerous host operations stay **dry-run** until `YSK_EXECUTE=1`. A blocked result is not success.
- The first panel certificate is self-signed. Replace it with Let’s Encrypt (or your own) when the host has a name.

## Support

YSK Server is **free**. If it helps:

- Panel **Support** (`/support`) — creator, donate, crypto handles
- [Linktree](https://linktr.ee/yanshekki) · GitHub Sponsors
- Crypto: `yanshekki.eth` (EVM) · `yanshekki.near` · `$yanshekki` (ADA)
- Hands-on work: **YSK Limited** — write to us (no prices on this page)
- Bugs and questions: [email@ysk.hk](mailto:email@ysk.hk)

## Development

```bash
pnpm install && pnpm build
pnpm --filter ysk-server exec node --import tsx/esm src/cli.ts setup --data-dir .ysk --json
pnpm --filter ysk-server exec node --import tsx/esm src/cli.ts serve --data-dir .ysk
```

Architecture and contribution notes live under **[docs/](docs/INDEX.md)**.

---

<p align="center">
  <strong>YSK Server</strong> · control without a landlord ·
  <a href="https://ysk.hk/">ysk.hk</a> ·
  <a href="mailto:email@ysk.hk">email@ysk.hk</a>
</p>
