# DNS, SSL & Nginx

> Language: English | [中文](./dns-ssl-nginx-ZH.md)

## Purpose

Manage **DNS zones** (written vs live), **TLS certificates**, and **Nginx** as the default project edge — including DNSSEC helpers, PowerDNS heal, and cert inventory.

**Non-goals:** Taking over an external DNS account as the zone editor. **DDNS** may use a provider token only to upsert named A/AAAA when this host’s WAN address changes. Written zone files alone are not public authority until apply/reload succeeds.

## Panel

| Item | Value |
|------|--------|
| Routes | `/dns`, `/ssl`, `/nginx` |
| Nav keys | `dns`, `ssl`, `nginx` |
| Main actions | Zones · records validate · DNSSEC · heal · certs · nginx status/sync |
| Capability | DNS / SSL / Nginx |
| RBAC | Hosting operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| List/write zones | `ysk-server dns zones\|zone …` | write-host | zone write may reload |
| DNSSEC list/generate | `ysk-server dns dnssec list\|generate --zone …` | write-host | generate needs execute |
| Heal PowerDNS | `ysk-server dns heal --execute` | write-host | |
| DNS health / lookup | `ysk-server dns health\|lookup …` | read | |
| Validate record set | `ysk-server dns records --records '[]'` | read | |
| DDNS status / probe / update | `ysk-server dns ddns status\|probe\|update\|enable\|disable` | write-host | WAN A/AAAA upsert; probe is detect-only; publish needs execute; `--force` republishes unchanged |
| SSL list/get | `ysk-server ssl list\|get --domain …` | read | |
| Bootstrap / panel TLS | `ysk-server ssl bootstrap\|panel-tls …` | write-host | |
| Nginx status/list/test/sync | `ysk-server nginx status\|list\|test\|sync` | write-host | sync |

## CLI quick start

```bash
ysk-server dns zones --json
ysk-server dns health --json
ysk-server ssl list --json
ysk-server nginx status --json
export YSK_EXECUTE=1
ysk-server nginx sync --execute --json
ysk-server dns dnssec generate --zone example.com --execute --json
ysk-server dns ddns status --json
ysk-server dns ddns probe --json
ysk-server dns ddns update --force --execute --json
```

## Honesty

- **written** zone in dataDir ≠ public resolver truth.  
- LE issue needs outbound network + EXECUTE.  
- Nginx sync dry-run until `--execute`.  
- DDNS **probe** only detects WAN. Publish needs `--execute`. Empty or private IPs are never written.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| — | None required |

## Related

- [Nginx sites](./nginx-sites.md)  
- [Apache](./apache.md)  
- [CLI reference](../cli/reference.md)  
