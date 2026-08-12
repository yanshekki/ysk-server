# Logs & metrics

> Language: English | [中文](./logs-metrics-ZH.md)

## Purpose

**Log center** queries (sources, journal) and **host metrics** overview.

**Non-goals:** Full SIEM replacement; infinite log shipping.

## Panel

| Item | Value |
|------|--------|
| Routes | `/logs`, `/metrics` |
| Nav keys | `logs`, `metrics` |
| Main actions | Sources · query · journal · metrics charts |
| Capability | Logs / host metrics |
| RBAC | Operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Log sources / query / journal | `ysk-server logs sources\|query\|journal\|overview` | read | |
| Host metrics / overview | `ysk-server host metrics\|overview` | read | |

## CLI quick start

```bash
ysk-server logs sources --json
ysk-server logs query --json
ysk-server host metrics --json
```

## Honesty

- Read-only probes; no silent “we fixed the outage”.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Live charts / stream UX | CLI returns snapshots |

## Related

- [System host](./system-host.md)  
