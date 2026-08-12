# npm publish

> Language: English | [中文](./npm-publish-ZH.md)

## Public package

| Package | Role | Install |
|---------|------|---------|
| **`ysk-server`** | Control plane API + CLI bin `ysk-server` | `npm install -g ysk-server` |

Product page: **https://www.npmjs.com/package/ysk-server**

### Monorepo (workspace only)

| Package | Role |
|---------|------|
| `@ysk-server/shared` | Types / locales |
| `@ysk-server/core` | Hosting / security logic |
| `@ysk-server/web` | Panel SPA (private; embedded at pack) |
| `ysk-server` | Publishable CLI + API |

`@ysk-server/shared` and `@ysk-server/core` are **bundled** into the public `ysk-server` tarball (`bundleDependencies`). Users never install those scopes from the registry — no npm org required.

## Prerequisites

1. npm account that can publish `ysk-server` (e.g. **yanshekki**).
2. Prefer **Automation** token in `~/.npmrc`.
3. `npm whoami` works; Node ≥ 20.

## Publish

```bash
# bump apps/server/package.json version when releasing
bash scripts/publish-ysk-server-npm.sh           # dry-run
bash scripts/publish-ysk-server-npm.sh --publish
```

## Verify

```bash
npm view ysk-server version
npm install -g ysk-server
ysk-server help
```

Use **≥ 1.0.2** (or the version you just published). Same version cannot be republished.
