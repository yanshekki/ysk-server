# Frontend UI

> Language: English | [中文](./frontend-ui-ZH.md)

## Stack

- App: `apps/web` (React + TypeScript)
- Layout: FSD-lite pages + shared UI kit
- i18n: catalogs from `ysk-server-shared` (default zh-HK)

## Principles

1. Operator-visible strings use `t()` only.  
2. One primary entry per feature (see feature-single-entry).  
3. Ops results show honest blocked / dry-run states.  
4. List pages use shared list-query / toolbar patterns.  
5. No runtime CDN: JS, CSS, and fonts ship in the panel build (system fonts).
6. Lists use the shared `DataTable`: desktop is a real table; ≤720px is cards + a ⋯ action menu.
7. Mobile header is menu + search only. Language, account, and logout sit at the **bottom** of the drawer.
8. Operation results use the **top-right toast** (`toast.ok` / `toast.error`). Live streams and long jobs use the **bottom-right dock** (minimizable). Do not embed install logs or one-shot apply errors in the page body.

## Key routes

See [product-page-map.md](./product-page-map.md).

## Related

[i18n.md](./i18n.md) · [architecture/overview.md](./architecture/overview.md)
