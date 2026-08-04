# MySQL ↔ MariaDB exclusive switch — acceptance (100%)

## Product rules

1. One host → one SQL server flavor (`mysql` XOR `mariadb`).
2. Bare one-click install of the other engine is **refused** (`needs_exclusive_switch`).
3. Confirmed switch: **dump user DBs first** → then stop / backup datadir / purge → install target → import → verify.
4. Dump failure → **failed_safe**, source left running, **no purge**.
5. After purge/import failure → **failed_need_manual** with dump path + datadir backup path.

## Operator flow

1. Open MySQL or MariaDB **service** page when the other engine is present.
2. One-click install → danger dialog (warnings + DB list).
3. Check acknowledge + type **`SWITCH`**.
4. Wait for ops result; refresh console.

Optional root password when socket auth is unavailable:

- Env: `YSK_SQL_ROOT_PASSWORD=…`
- Or POST body `rootPassword` on `/api/v1/system/db/sql-engine/switch`

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/system/db/sql-engine/switch-preview?target=mysql\|mariadb` | Preview only |
| POST | `/api/v1/system/db/sql-engine/switch` | Confirmed migrate |

POST body:

```json
{
  "target": "mysql",
  "confirmPhrase": "SWITCH",
  "acknowledgeExclusive": true,
  "migrateData": true,
  "rootPassword": "optional"
}
```

## Acceptance checklist

- [x] Exclusive gate on `installSoftware` without in-process auth
- [x] Preview lists user DBs + warnings + confirm phrase
- [x] Confirm required (phrase + acknowledge)
- [x] Dump → grants → stop → datadir backup → purge → install → wait unit → import → verify
- [x] Dump fail → no purge (`failed_safe`) — unit tested
- [x] Datadir mv fail → restart source, no purge — unit tested
- [x] Unit wait through `activating` (`waitUnitActive`)
- [x] UI dialog + banner intercept
- [x] i18n en / zh-CN / zh-HK
- [x] Optional root password for clients

## Out of scope (v1)

- Side-by-side MySQL+MariaDB
- Physical datadir conversion
- One-click rollback UI (manual dump/datadir restore only)
- Full web E2E against real apt on CI
