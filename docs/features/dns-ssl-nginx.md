# DNS, SSL & Nginx

> Language: English | [中文](./dns-ssl-nginx-ZH.md)

## Purpose

Manage **DNS zones** (written vs live), **TLS certificates**, and **Nginx** as the default project edge — including DNSSEC helpers, PowerDNS heal, and cert inventory.

**Non-goals:** Owning external DNS provider accounts; written zone files alone are not public authority until apply/reload succeeds.

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
```

## Honesty

- **written** zone in dataDir ≠ public resolver truth.  
- LE issue needs outbound network + EXECUTE.  
- Nginx sync dry-run until `--execute`.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| — | None required |

## Related

- [Nginx sites](./nginx-sites.md)  
- [Apache](./apache.md)  
- [CLI reference](../cli/reference.md)  
