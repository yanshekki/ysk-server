# Spec readiness — honest gate

This product is evaluated against [AI-Secure-Linux-Server-Manager-Spec.md](../AI-Secure-Linux-Server-Manager-Spec.md).

## How to probe

```bash
ysk-server readiness --data-dir /var/lib/ysk-server --json
# or
curl -sS http://127.0.0.1:9287/api/v1/readiness | jq .
```

Panel: **`/system/readiness`** — auto-run probe, blockers first, category groups, fix deep-links (`fixHref`), download JSON.

Exit codes (CLI): `0` = `productionReady`, `2` = not fully production-capable.

HTTP: `200` if productionReady, else `503` with **full** report body (items + blockers + categories). Clients must parse JSON on 503, not treat as empty failure.

## What `productionReady` means (strict)

All of:

1. Process is **root**
2. `YSK_EXECUTE=1` (host mutations allowed)
3. **nginx** and **node** on PATH
4. Control-plane `dataDir` exists

Missing optional binaries (postfix, pdnsutil, mysql, …) appear as **degraded**, not fake ready.

## Modes

| Mode | Conditions | Expectation |
|------|------------|-------------|
| `degraded` | non-root or no EXECUTE | dataDir projects, pidfile/PM2, managed confs, Web UI |
| `production_capable` | root + EXECUTE | useradd, systemd, nginx conf.d, apt paths |

## Spec phase mapping (honest)

| Spec phase | Status |
|------------|--------|
| Phase 1 architecture + auth + allowlist | Usable |
| Phase 2 Node hosting vertical | Usable (dual-mode) |
| Phase 2 PHP/DB/SSL | Dual-mode / partial |
| Phase 3 Email MTA full production | Templates + optional install; external DNS/PTR operator-owned |
| Phase 3 PowerDNS | Zone files + pdnsutil load; apt helper |
| Phase 3 Agent fleet installers | Probe + unit templates; full vendor installers = backlog (out of Admin 100%) |
| Unit tests (`@ysk/core`) | **295 green** (2026-07-28 continuous coverage push) |
| ≥90% line coverage | Still engineering debt (~62% stmts); not a product-feature gate |

## Do not over-claim

- Managed configs under `dataDir` ≠ system service running
- `ok: false` when EXECUTE skipped is **correct** fail-closed behaviour
- External email deliverability (PTR, Port 25, DNS at registrar) is **never** claimed as fully automatic

## Operator checklist

See **[admin-ops-checklist.md](./admin-ops-checklist.md)** for a server-admin go-live list (sites, DNS, mail, backup cron install, security).
