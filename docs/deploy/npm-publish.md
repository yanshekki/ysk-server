# npm publish

> Language: English | [中文](./npm-publish-ZH.md)

Publish public packages from this monorepo to [npmjs.com](https://www.npmjs.com/):

| Package | Role | Install |
|---------|------|---------|
| `@ysk/shared` | Types / locales | dependency |
| `@ysk/core` | Hosting / security logic | dependency |
| `@ysk/server` | Control plane API + **CLI bin `ysk-server`** | `npm install -g @ysk/server` |

`@ysk/web` stays private (SPA is embedded into `@ysk/server` `public/web` at pack time).

## Prerequisites

1. **npm account** with 2FA enabled (required for publish).
2. **Access to the `@ysk` scope** — create a free organization once:
   - Browser: https://www.npmjs.com/org/create → name `ysk` → public packages
   - Or after login: ensure you can publish scoped public packages under `@ysk/*`
3. **Automation token** (recommended for CI / headless):
   - https://www.npmjs.com/settings/~/tokens → **Generate New Token** → **Automation**
   - Save to `~/.npmrc`:

```ini
//registry.npmjs.org/:_authToken=npm_XXXXXXXX
```

4. Verify:

```bash
npm whoami
# expect your npm username
```

5. Node ≥ 20, pnpm 9+, clean tree preferred.

## One-shot (recommended)

Dry-run (build, gates, tests, pack — no registry write):

```bash
bash scripts/prepare-release.sh
```

Real publish (same pipeline + `pnpm publish`):

```bash
bash scripts/prepare-release.sh --publish
```

Order is fixed: **shared → core → server**.

## Manual publish

```bash
pnpm install --frozen-lockfile
pnpm gates
pnpm typecheck
pnpm build

# Embed web UI into the server package
mkdir -p apps/server/public/web
rm -rf apps/server/public/web/*
cp -a apps/web/dist/. apps/server/public/web/

pnpm --filter @ysk/shared publish --access public
pnpm --filter @ysk/core publish --access public
pnpm --filter @ysk/server publish --access public
```

`workspace:*` dependencies are rewritten to real versions by pnpm on publish.

## Verify after publish

```bash
npm view @ysk/server version
npm view @ysk/server bin
npm install -g @ysk/server
ysk-server --help
```

Product installer:

```bash
# install.sh uses PKG=@ysk/server (CLI name remains ysk-server)
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive
```

## Version bumps

Bump `version` in lockstep for packages you publish (today all at `1.0.0`):

- `packages/shared/package.json`
- `packages/core/package.json`
- `apps/server/package.json`

Root `package.json` is **private** and is not published.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `401 Unauthorized` on `npm whoami` | Replace expired token; re-login |
| `402` / no permission for `@ysk/*` | Create org `ysk` and add your user as owner |
| `403` two-factor | Use an **Automation** token, or complete OTP for publish |
| Pack missing panel UI | Ensure `apps/web/dist` exists before embed step |
| Native build fails on install | Host needs build tools (`python3`, `make`, `g++`) for `better-sqlite3` / `node-pty` |

Self-hosted git deploy does not require npm publish.
