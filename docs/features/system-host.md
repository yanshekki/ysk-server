# System & host

> Language: English | [中文](./system-host-ZH.md)

**Panel routes:** `/system`, `/services`, `/updates`, readiness  
**CLI:** `system`, `services`, `update`, `readiness`, `doctor`, `host`

## Control plane unit

```bash
ysk-server system unit-install --enable --execute
```

## Services matrix

Probe systemctl units (nginx, db, mail, fail2ban, …).

```bash
ysk-server services --json
```

## Updates

Inventory / advisor / apply plans for packages (EXECUTE for real apt).

```bash
ysk-server update --check --json
ysk-server update --apply --execute --json
```

## Readiness

```bash
ysk-server readiness --json
ysk-server doctor --json
```

Interpreting report: `productionReady`, per-item `level` (ready/degraded/missing), `fixHint`. HTTP may 503 when not ready but still returns full body.

## Related

[../getting-started/readiness.md](../getting-started/readiness.md) · [logs-metrics.md](./logs-metrics.md)
