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
