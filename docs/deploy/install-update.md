# Install and update

> Language: English | [中文](./install-update-ZH.md)

Install monorepo or package; use `ysk-server setup` and `ysk-server update`.

```bash
pnpm install && pnpm build
ysk-server setup --data-dir /var/lib/ysk --json
ysk-server update --check --json
```

See [../getting-started/install.md](../getting-started/install.md).

## Panel updates UI

- **Updates** (`/updates`) is the host-wide hub: panel npm + catalog services + runtimes + remaining apt. CLI: `ysk-server updates hub --json` (same `entries` as `GET /api/v1/updates`). `ysk-server update` is product self-update only.
- The former **Software hub** (`/software`) redirects to `/updates`. Install software from each feature page.
- The server runs job `updates.scan` on a configurable interval (default 24h): refresh inventory + panel check only — **no automatic apt upgrade**.
- Sidebar badge counts pending package upgrades + panel update from `GET /api/v1/updates/summary`.

## Feature install / uninstall

- Feature pages use **one-click install** and **uninstall…** (`SoftwareInstallBanner` / `SoftwareVersionBar`).
- Uninstall opens a wizard: impact list → keep/purge data policy → double confirm (checkbox + type `UNINSTALL`).
- Install and uninstall stream logs over SSE; the **OpsStreamDock** (bottom-right) can be minimized while work continues.
- APIs: `POST /api/v1/system/software/install`, `…/uninstall-preview`, `…/uninstall` (Accept `text/event-stream` for live log).
- Default data policy is **keep** (remove packages, keep config/data). **purge** deletes allowlisted paths only.
- Needs `YSK_EXECUTE` + root; otherwise responses are honestly `blocked`.
