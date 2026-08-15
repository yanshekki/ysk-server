# System & host

> Language: English | [中文](./system-host-ZH.md)

## Purpose

Operate the **control-plane host**: systemd unit, service matrix, metrics, network service exposure, real-IP trust, panel TLS, host package updates, and software catalog installs.

**Non-goals:** Multi-host fleet orchestration (see CDN/agents); marketing “one-click secure forever”.

## Panel

| Item | Value |
|------|--------|
| Routes | `/system`, `/services`, `/network`, `/updates`, readiness |
| Nav keys | `services`, `metrics`, `network`, `updates`, `readiness`, `systemd`, … |
| Main actions | Unit · services · exposure · real-IP · panel TLS · updates · software banners |
| Capability | System / host / firewall as applicable |
| RBAC | Admins / system operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Host overview / metrics | `ysk-server host overview\|metrics --json` | read | |
| Services matrix | `ysk-server services … --json` | read | |
| Control-plane unit | `ysk-server system unit-install --execute` | write-host | |
| Service exposure list/put/sync | `ysk-server network exposure …` | write-host | `ysk-svc` rules |
| Real-IP status/set/refresh | `ysk-server real-ip status\|set\|refresh` | write-host | refresh needs execute |
| Panel TLS | `ysk-server ssl panel-tls status\|enable\|disable\|issue` | write-host | issue needs execute |
| Update hub (panel + services + runtimes + apt) | `ysk-server updates hub [--refresh-runtimes] --json` | read | Same `entries` as `GET /api/v1/updates` |
| Package inventory | `ysk-server updates inventory\|refresh --json` | read | Apt list only |
| Apply package | `ysk-server updates apply --package … --execute` | write-host | |
| Software catalog | `ysk-server software list\|install\|uninstall …` | write-host | `software get postgresql` treats an active unit as installed when `postgres` is not on PATH. |
| Leftover probe | `ysk-server hosting leftovers` | read | Also folded into readiness. Overlay does **not** rewrite Apache / nginx / vsftpd / Dovecot. |
| Stack plans | `ysk-server stack plans\|status\|install …` | write-host | |
| Product self-update | `ysk-server update --check\|--apply` | write-host | npm `ysk-server@x` + verify + restart |
| Readiness / doctor | `ysk-server readiness\|doctor --json` | read | |

## CLI quick start

```bash
ysk-server host overview --json
ysk-server network exposure list --json
ysk-server real-ip status --json
ysk-server ssl panel-tls status --json
ysk-server updates hub --json
ysk-server updates inventory --json
ysk-server software list --json
ysk-server readiness --json
export YSK_EXECUTE=1
ysk-server network exposure sync --service nginx --execute --json
```

Full argv: [../cli/reference.md](../cli/reference.md).

## Honesty

- Exposure probes may degrade without EXECUTE (desired state still listed).  
- **written** package plans ≠ applied apt.  
- Readiness may exit non-zero while still returning full JSON.  
- Product overlay does not heal leftover host files; leftovers stay visible until the matching apply command.  
- Stopping the control-plane unit and disabling panel HTTPS require a confirm phrase. Pack uninstall is disabled when nothing is selected.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Host Browse Chromium | See [host-browse.md](./host-browse.md) |

## Related

- [Databases](./databases.md)  
- [Defense](./defense.md)  
- [Readiness](../getting-started/readiness.md)  
- [Panel ↔ CLI matrix](../cli/panel-parity-matrix.md)  
