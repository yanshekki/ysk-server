# Resource CRUD model (control plane)

Every account-style hosting resource follows the same lifecycle:

1. **List** in a professional data table  
2. **Create** via modal / wizard (steps when multi-field)  
3. **Edit** via modal  
4. **Delete** with confirm  
5. **Apply** writes system/dataDir artifacts (fail-closed without `YSK_EXECUTE`)

## API

```
GET/POST    /api/v1/resources/<collection>
GET/PATCH/DELETE /api/v1/resources/<collection>/:id
POST        /api/v1/resources/<collection>/:id/apply
```

| Collection | Path |
|------------|------|
| Nginx sites | `nginx/sites` |
| FTP accounts | `ftp/accounts` |
| MySQL DBs / users | `mysql/databases`, `mysql/users` |
| Postgres DBs / users | `postgres/databases`, `postgres/users` |
| Redis | `redis/instances` |
| DNS zones / records | `dns/zones`, `dns/records` |
| SSL certs | `ssl/certs` |

Store collections live on `JsonStore` snapshot (`nginx_sites`, `ftp_accounts`, …).

## UI

- `ResourceTable` + `ResourceStatusBadge`  
- Pages under `apps/web/src/pages/features/*`  
- Hook: `useResourceCrud(collection)`

## Status

`draft` → `planned` → `applied` | `failed`
