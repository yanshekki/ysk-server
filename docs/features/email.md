# Email

> Language: English | [中文](./email-ZH.md)

**Panel routes:** `/email`, `/email/domains/:id`  
**CLI:** `email`, `hosting email-*`

## What it does

| Area | Capability |
|------|------------|
| Domains | DKIM material, DNS record suggestions |
| Mailboxes | Maildir + maps under dataDir |
| Deliverability | Live MX/SPF/DKIM/DMARC/PTR/Port25/DNSBL |
| Relay | SMTP relay when Port 25 blocked |
| Warm-up | Phased sending guidance |
| Webmail | Roundcube plan / install helper |

## CLI

```bash
ysk-server email domains list|create --domain example.com --ip A.B.C.D
ysk-server email mailboxes create --domain example.com --local app
ysk-server email deliverability --domain example.com --json
ysk-server email bootstrap --domain example.com --ip A.B.C.D
ysk-server email dns --domain example.com
```

## Operator external steps

1. Publish MX/TXT at **registrar / authoritative DNS**.  
2. Set **PTR** at VPS console to mail hostname.  
3. Unblock **Port 25** or configure relay.  

## Honesty

Panel **never** guarantees Gmail/Outlook inbox. PTR and Port 25 are not controlled by YSK.

## Related

[../email/deliverability.md](../email/deliverability.md) · [../cli/reference.md](../cli/reference.md)
