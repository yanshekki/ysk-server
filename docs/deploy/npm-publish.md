# npm publish

> Language: English | [中文](./npm-publish-ZH.md)

## Public packages (npmjs.com)

| Package | Role | URL |
|---------|------|-----|
| **`ysk-server`** | Product CLI + API + panel | https://www.npmjs.com/package/ysk-server |
| **`ysk-server-shared`** | Types / locales | https://www.npmjs.com/package/ysk-server-shared |
| **`ysk-server-core`** | Hosting / security core | https://www.npmjs.com/package/ysk-server-core |

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
