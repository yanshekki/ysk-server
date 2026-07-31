# Email deliverability ops pack (C3)

> Language: English | [中文](./deliverability-ZH.md)

**Honesty first:** YSK **never** guarantees Gmail/Outlook inbox placement. PTR and Port 25 are **VPS-provider** responsibilities; MX/SPF/DKIM/DMARC must be published at the **DNS provider**.

## What the pack does

Unified report combining:

| Check | Owner |
|-------|--------|
| MX / SPF / DKIM / DMARC live DNS | DNS provider |
| PTR reverse DNS | VPS / cloud console |
| Outbound Port 25 probe | VPS network |
| DNSBL (Spamhaus / SpamCop / Barracuda) | Operator reputation |
| SMTP relay config (if Port 25 blocked) | Operator + panel |
| Warm-up phases | Operator process |

## API

```http
GET /api/v1/email/domains/:id/deliverability
GET /api/v1/email/deliverability/overview
```

Response always includes:

- `deliveryGuaranteed: false`
- `honesty: string[]`
- `items[]` with `owner` ∈ `panel | dns_provider | vps_provider | operator`
- `warmup` plan
- `panelReady` — panel-checkable DNS+DNSBL only (not “global delivery OK”)

## CLI

```bash
ysk-server hosting email-deliverability --domain example.com
# exit 0 if panelReady; 1 if gaps on checkable items
```

## Panel

Email domain → **Deliverability** tab → **Run deliverability pack**.

Also linked from Health tab.

## Related

- Live checks: `POST …/live-check`
- DNSBL: `POST /api/v1/email/dnsbl/check`
- Warmup: `POST /api/v1/email/warmup`
- Relay: `GET/POST /api/v1/email/relay`
- External setup: [external-setup.md](./external-setup.md)
