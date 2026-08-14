# ysk-server

**YSK Server** — free single-host Linux control plane: HTTP API, **CLI** (`ysk-server`), and embedded web panel.

| | |
|--|--|
| **Install** | `npm install -g ysk-server` |
| **CLI bin** | `ysk-server` |
| **Node** | ≥ 22 (native deps need `python3`, `make`, `g++` on the host) |
| **License** | MIT |
| **Source** | [github.com/yanshekki/ysk-server](https://github.com/yanshekki/ysk-server) |
| **Support** | [email@ysk.hk](mailto:email@ysk.hk) |

## Quick start

```bash
npm install -g ysk-server

# first-time setup (data dir + admin credentials)
sudo ysk-server setup

# run control plane (panel + API)
sudo ysk-server serve

ysk-server help
ysk-server readiness --json
```

Default panel (root install): **`https://<server-ip>:9287`**  
(accept the self-signed certificate warning on first visit)

## Full installer

Ubuntu 22.04 / 24.04 as **root**:

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive
```

## Package family

| Package | Role |
|---------|------|
| **[ysk-server](https://www.npmjs.com/package/ysk-server)** | **This package** — CLI + API + embedded panel |
| [ysk-server-shared](https://www.npmjs.com/package/ysk-server-shared) | Shared types / locales |
| [ysk-server-core](https://www.npmjs.com/package/ysk-server-core) | Hosting / security core |

`ysk-server` depends on `ysk-server-shared` and `ysk-server-core` (also **bundled** in the tarball for reliable installs).

## What’s in this tarball

| Path | Contents |
|------|----------|
| `dist/` | Compiled control plane + CLI |
| `public/web/` | Embedded web panel (SPA) |
| `node_modules/ysk-server-{shared,core}/` | Bundled libraries (when present) |
| `README.md` | This file |

**Full monorepo source** (TypeScript, web app, docs, install scripts) lives on GitHub — not on the npm “Code” tab:

https://github.com/yanshekki/ysk-server

## Docs

- [Product README](https://github.com/yanshekki/ysk-server#readme)
- [Install guide](https://github.com/yanshekki/ysk-server/blob/main/docs/getting-started/install.md)

## Uninstall

```bash
npm uninstall -g ysk-server
```
