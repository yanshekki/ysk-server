# Spec readiness — honest gate

This product is evaluated against [AI-Secure-Linux-Server-Manager-Spec.md](../AI-Secure-Linux-Server-Manager-Spec.md).

## How to probe

```bash
ysk-server readiness --data-dir /var/lib/ysk-server --json
# or
curl -sS http://127.0.0.1:8787/api/v1/readiness | jq .
```

Exit codes (CLI): `0` = `productionReady`, `2` = not fully production-capable.

HTTP: `200` if productionReady, else `503` with full item list (not a fake OK).

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
| Phase 3 Agent fleet installers | Probe + unit templates; full vendor installers backlog |
| ≥90% coverage | Not yet — see `pnpm test:coverage` |

## Do not over-claim

- Managed configs under `dataDir` ≠ system service running
- `ok: false` when EXECUTE skipped is **correct** fail-closed behaviour
- External email deliverability (PTR, Port 25, DNS at registrar) is **never** claimed as fully automatic
