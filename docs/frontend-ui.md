# Frontend UI

> Language: English | [中文](./frontend-ui-ZH.md)

## Stack

- App: `apps/web` (React + TypeScript)
- Layout: FSD-lite pages + shared UI kit
- i18n: catalogs from `@ysk/shared` (default zh-HK)

## Principles

1. Operator-visible strings use `t()` only.  
2. One primary entry per feature (see feature-single-entry).  
3. Ops results show honest blocked / dry-run states.  
4. List pages use shared list-query / toolbar patterns.

## Key routes

See [product-page-map.md](./product-page-map.md).

## Related

[i18n.md](./i18n.md) · [architecture/overview.md](./architecture/overview.md)
