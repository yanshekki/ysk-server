# Email deliverability

> Language: English | [中文](./deliverability-ZH.md)

## Purpose

Live and stored checks for mail domains: MX, SPF, DKIM, DMARC, PTR, outbound Port 25, DNSBL, optional relay and warm-up guidance.

## CLI

```bash
ysk-server email deliverability --domain example.com --json
ysk-server email bootstrap --domain example.com --ip A.B.C.D --json
ysk-server hosting email-deliverability --domain example.com --json
```

## Report items

| Item | Meaning |
|------|---------|
| MX / SPF / DKIM / DMARC | DNS publication checks |
| PTR | Reverse DNS vs mail hostname |
| Port 25 | Outbound TCP 25 probe |
| DNSBL | Multi-list reputation |
| Relay | Configured when Port 25 blocked |
| Warm-up | Phased sending guidance |

## Honesty

- Panel **never** guarantees Gmail/Outlook inbox placement.  
- PTR and Port 25 are owned by the VPS/network provider.  
- Authoritative DNS must be published externally.

## Related

[external-setup.md](./external-setup.md) · [../features/email.md](../features/email.md)
