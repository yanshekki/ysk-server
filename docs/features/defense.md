# Defense center

> Language: English | [中文](./defense-ZH.md)

**Panel routes:** `/protection`, `/firewall`, `/fail2ban`  
**CLI:** `defense` / `protection`

## What it does

Unified host defense: UFW script generation, fail2ban jails, ban/unban/whitelist, presets, timeline, optional Cloudflare helpers.

## CLI

```bash
ysk-server defense status --json
ysk-server defense firewall --json
ysk-server defense fail2ban --json
ysk-server defense ban --ip 1.2.3.4 --json          # dry-run plan by default
ysk-server defense ban --ip 1.2.3.4 --execute --json
ysk-server defense presets --json
ysk-server defense timeline --json
ysk-server defense stack-apply --execute --json
```

## Honesty

Without `YSK_EXECUTE=1` (and often root), actions stay **blocked** or only write managed files under dataDir. Never reports live firewall success when blocked.

## Related

[../deploy/defense.md](../deploy/defense.md) · [../cli/reference.md](../cli/reference.md)
