# npm publish

> Language: English | [中文](./npm-publish-ZH.md)

## Public package

| Package | Role | Install |
|---------|------|---------|
| **`ysk-server`** | Control plane API + CLI bin `ysk-server` | `npm install -g ysk-server` |

Product page: **https://www.npmjs.com/package/ysk-server**

Workspace packages `@yanshekki/shared` and `@yanshekki/core` are **bundled inside** the `ysk-server` tarball (`bundleDependencies`). Installers only need the unscoped package.

`@yanshekki/web` stays private; SPA is embedded into `ysk-server` `public/web` at pack time.

## Prerequisites

1. npm user **yanshekki** (or collaborator).
2. Prefer an **Automation** token in `~/.npmrc`:

```ini
//registry.npmjs.org/:_authToken=npm_XXXXXXXX
```

3. `npm whoami` → `yanshekki`
4. Node ≥ 20, build tools for native addons (`python3`, `make`, `g++`) on install hosts.

## Publish

```bash
# bump version in apps/server/package.json first if needed
bash scripts/publish-ysk-server-npm.sh           # dry-run
bash scripts/publish-ysk-server-npm.sh --publish # real publish
```

## Verify

```bash
npm view ysk-server version
npm install -g ysk-server
ysk-server help
```

## Notes

- Versions **1.0.0–1.0.1** may be incomplete; use **≥ 1.0.2**.
- Do not re-publish the same version number (npm forbids overwrite).
- After any token leak in chat/logs, **revoke** it on npmjs.com and create a new Automation token.
