# Email external setup

> Language: English | [中文](./external-setup-ZH.md)

## Purpose

Operators must complete steps **outside** the control plane: registrar DNS, VPS PTR, Port 25 unlock or SMTP relay.

## Principles

1. The panel generates record suggestions and runs checks.  
2. It **cannot** edit registrar DNS or cloud PTR for you.  
3. External todos must stay visible until green.

## Checklist

| Area | Owner | Action |
|------|-------|--------|
| MX / SPF / DKIM / DMARC | DNS provider | Publish records from panel suggestions |
| PTR | VPS / cloud console | Match mail hostname / HELO |
| Port 25 | Hosting provider | Unblock outbound 25 **or** configure relay |
| Reputation | Operator | Warm-up; monitor DNSBL |

## CLI

```bash
ysk-server email dns --domain example.com --json
ysk-server email deliverability --domain example.com --json
```

## Related

[deliverability.md](./deliverability.md) · [../features/email.md](../features/email.md)
