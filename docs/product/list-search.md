# List search / filter (C1)

> Language: English | [中文](./list-search-ZH.md)

**Rule:** Feature tables use **server-backed** list search — `GET …?q=&filter=` + `meta`, not client-only `useMemo` on full dumps.

## Building blocks

| Piece | Path |
|-------|------|
| Query contract | `@yanshekki/shared` `parseListQuery` / `buildListQueryString` / `ListMeta` |
| Server filter | `@yanshekki/core` `applyListQuery` · `listWithQuery` (HTTP) |
| Web hook | `useServerList` · resource `useResourceCrud` (debounced `q`) |
| UI | `ListToolbar` · `ServerListFilters` |

## Covered surfaces (C1)

| Surface | Backend | UI |
|---------|---------|-----|
| Users / packages | ✅ | ListToolbar |
| Projects | ✅ | ListToolbar |
| Email domains | ✅ | ListToolbar |
| Updates inventory | ✅ | ListToolbar |
| Resource CRUD (FTP, DNS, nginx, MySQL, Postgres…) | ✅ `?q=` | ServerListFilters |
| Fleet agents | ✅ | ServerListFilters + status chips |
| SSL certificates | ✅ | ServerListFilters |
| CDN nodes / sites | ✅ | ServerListFilters |
| Files browser | ✅ `q` | debounced search input |
| Cron / audit / managed-nginx / resources (API) | ✅ | CLI / partial UI |

## Remaining polish (not blocking C1)

- Protection / Firewall / Fail2ban event tables (host snapshot — prefer toolbar + server filter of snapshot)
- Services matrix (client chips OK for small matrix; optional server later)
- Security sessions / API keys lists (self-service; low volume)

## Agent / CLI

```bash
ysk-server users list --q admin
ysk-server packages list --q starter
ysk-server projects list   # JSON; extend --q when listing via API proxy
```

Resource APIs already accept `?q=` on `GET /api/v1/resources/{collection}`.
