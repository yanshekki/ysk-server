# Defense & protection

> Language: English | [中文](./defense-ZH.md)

## Purpose

Host **firewall / fail2ban / Defense Center** operations with honest blocked states when EXECUTE is off.

**Non-goals:** Guaranteed zero intrusion; geo/IP policy still depends on host tools.

## Panel

| Item | Value |
|------|--------|
| Route | `/protection` |
| Nav key | `protection` |
| Main actions | Status · firewall · fail2ban · ban/unban · presets · timeline |
| Capability | Defense |
| RBAC | Security operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Status / stack | `ysk-server defense status --json` | read | `protection` alias |
| Firewall / fail2ban deep | `ysk-server defense firewall\|fail2ban` | read | |
| Ban / unban / whitelist | `ysk-server defense ban\|unban\|… --execute` | write-host | |
| Presets / timeline | `ysk-server defense presets\|timeline` | read | |
| Stack apply | `ysk-server defense stack-apply --execute` | write-host | |

## CLI quick start

```bash
ysk-server defense status --json
ysk-server defense fail2ban --json
export YSK_EXECUTE=1
ysk-server defense ban --ip 1.2.3.4 --execute --json
```

## Honesty

- Live UFW/fail2ban mutations need EXECUTE + root.  
- Fail-closed without tools is correct, not a silent success.  
- The panel does not one-click ban the host egress IP, the current login IP, or fail2ban `ignoreip`. Those addresses are labelled.  
- Authenticated panel request rate is shown as panel traffic. It does not raise the threat score.  
- Nginx conf preview does not turn `set_real_ip_from` CIDRs into ban links.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| — | None |

## Related

- [Security auth](./security-auth.md) · [System host](./system-host.md)  
