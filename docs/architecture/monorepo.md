# Monorepo layout

> Language: English | [中文](./monorepo-ZH.md)

```
ysk-server/
  apps/
    server/     # @ysk/server — HTTP API, CLI entry
    web/        # @ysk/web — React panel
  packages/
    shared/     # @ysk/shared — DTOs, ops, errors, locales
    core/       # @ysk/core — domain logic + host adapter
  docs/         # This documentation tree
  scripts/      # gates, i18n, e2e helpers
```

| Package | Publish role | Depends on |
|---------|--------------|------------|
| `@ysk/shared` | Types + i18n | (none internal) |
| `@ysk/core` | Business logic | shared |
| `@ysk/server` | Runtime binary | core, shared |
| `@ysk/web` | Static UI build | shared (types/locales) |

## Core folders (high level)

| Path under `packages/core/src` | Domain |
|--------------------------------|--------|
| `hosting/` | projects, nginx, ssl, dns, db, defense, backup… |
| `email/` | domains, mailboxes, deliverability, warmup |
| `security/` | allowlist, totp, api-keys, ssh, rbac helpers |
| `files/` | sandboxed file manager |
| `host/` | executor, metrics, health |
| `db/` | document store backends |
| `services/` | auth, users-admin, scheduler |
| `agents/` | fleet sessions, outbound agent |
| `skills/` | tools planner, playbooks |

## Server folders

| Path | Role |
|------|------|
| `cli.ts` | All CLI commands |
| `routes/` | HTTP domain handlers |
| `app-context.ts` | Wire db + services |
| `cli/setup.ts` | First-time setup |

## Build

```bash
pnpm install
pnpm -r build
pnpm gates
```
