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

- **Updates** (`/updates`) is the single place for package inventory, panel self-update, and scan schedule.
- The former **Software hub** (`/software`) redirects to `/updates`. Install software from each feature page.
- The server runs job `updates.scan` on a configurable interval (default 24h): refresh inventory + panel check only — **no automatic apt upgrade**.
- Sidebar badge counts pending package upgrades + panel update from `GET /api/v1/updates/summary`.
