# Publishing YSK Server (npm)

Monorepo packages:

| Package | npm name | Role |
|---------|----------|------|
| shared | `@ysk/shared` | DTOs / types |
| core | `@ysk/core` | business logic |
| server | `@ysk/server` | **CLI + HTTP** (`ysk-server` bin) |
| web | `@ysk/web` | Vite UI (built assets served by server) |

Root package `ysk-server` is **`private: true`** (workspace only).

## Recommended publish path (maintainers)

```bash
pnpm install
pnpm build
pnpm test
pnpm e2e:real-ops

# Dry-run pack of the CLI package
pnpm --filter @ysk/server pack

# Publish in dependency order (when ready for public registry)
# pnpm --filter @ysk/shared publish --access public
# pnpm --filter @ysk/core publish --access public
# pnpm --filter @ysk/server publish --access public
```

Or use the helper:

```bash
bash scripts/prepare-release.sh
# then: bash scripts/prepare-release.sh --publish   # only if intentionally releasing
```

## Consumer install (after packages are on npm)

```bash
npm install -g @ysk/server
# or Spec name once unified:
# npm install -g ysk-server

ysk-server setup --non-interactive
ysk-server serve
```

Until public publish, use **from-source**:

```bash
git clone https://github.com/yanshekki/ysk-server.git
cd ysk-server
./install.sh --from-source --non-interactive
```

## Packaging notes

- `@ysk/server` depends on `@ysk/core` and `@ysk/shared` (workspace protocol in dev).
- Before first public publish, ensure `package.json` `dependencies` use semver ranges (not `workspace:*`) via `pnpm publish` which rewrites, or a release script.
- Ship Web UI by embedding into `apps/server/public/web` (done by `install.sh --from-source` and `prepare-release.sh`).
- `resolveWebRoot` also looks at `apps/server/public/web` and `YSK_WEB_ROOT`.
- `files` on `@ysk/server`: `dist/**` + `public/**`.

## Versioning

Align versions across `@ysk/*` for a release (currently `0.1.0`). Tag git: `v0.1.0`.

## Security

Do not publish with embedded secrets. `YSK_EXECUTE` stays off by default for consumers.
