# npm publish

> Language: English | [中文](./npm-publish-ZH.md)

## Public packages (npmjs.com)

| Package | Role | URL |
|---------|------|-----|
| **`ysk-server`** | Product CLI + API + panel | https://www.npmjs.com/package/ysk-server |
| **`ysk-server-shared`** | Types / locales (**same version as product**) | https://www.npmjs.com/package/ysk-server-shared |
| **`ysk-server-core`** | Hosting / security core (**same version as product**) | https://www.npmjs.com/package/ysk-server-core |

Install (users):

```bash
npm install -g ysk-server
```

> Note: Scoped names like `@ysk-server/core` are **not** used on the registry.
> The free npm account publishes **unscoped** packages (no org required).

## Publish

```bash
bash scripts/publish-ysk-server-npm.sh --publish
```

Order: **shared → core → ysk-server** (server bundles shared+core).

Each package ships a **README.md** for the npm package page.

Bump `version` in `packages/shared`, `packages/core`, and `apps/server` `package.json` to the **same** number before a new release. The publish script refuses a mismatch. Verify with `npm view ysk-server version`, `npm view ysk-server-shared version`, `npm view ysk-server-core version`, and `ysk-server help`.

## Trusted publishing

Pushing a tag `v*.*.*` runs [`.github/workflows/release.yml`](../../.github/workflows/release.yml). `workflow_dispatch` on that same tag also runs it. The job uses npm **Trusted Publishing** (GitHub OIDC): `permissions: id-token: write` and `contents: read`, Node 24, npm 11.21.0, then `npm publish --provenance --access public`.

Order is the same: **shared → core → ysk-server**. A version already on npm is skipped. The workflow does **not** read `NPM_TOKEN` or `NODE_AUTH_TOKEN`. `actions/setup-node` is not given `registry-url`, because that input exports a repo `NODE_AUTH_TOKEN` and writes an `_authToken` line. The publish script discards any such token and any `_authToken` line so the publish is OIDC provenance only.

Before the first tag, add a Trusted Publisher on npmjs.com for each of the three packages: GitHub Actions, owner `yanshekki`, repository `ysk-server`, workflow filename `release.yml`.

The manual script above is unchanged and still works with an npm login.
