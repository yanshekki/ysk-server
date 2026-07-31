# DNS, SSL, Nginx

> Language: English | [中文](./dns-ssl-nginx-ZH.md)

**Panel routes:** `/dns`, `/ssl`, `/nginx`  
**CLI:** `dns`, `ssl`, `nginx`, `hosting dns-*|powerdns-*`

## DNS

- Managed zone files under dataDir  
- Optional PowerDNS helpers / Cloudflare apply (token)  
- Validation hooks when tools exist  

```bash
ysk-server dns zones --json
ysk-server dns zone --zone example.com --ip A.B.C.D --json
ysk-server hosting powerdns-status --json
```

## SSL

- List certificates, bindings, expiry awareness  
- Upload PEM or Let’s Encrypt oriented paths  
- Never claim public HTTPS without real cert + nginx publish  

```bash
ysk-server ssl list --json
ysk-server ssl get --id … --json
```

## Nginx

- Per-project / managed conf under dataDir  
- `test` / `sync` toward system conf.d when EXECUTE+root  

```bash
ysk-server nginx status --json
ysk-server nginx list --json
ysk-server nginx test --json
ysk-server nginx sync --execute --json
```

## Honesty

Conf **written** under dataDir ≠ live vhost until sync/reload succeeds. Registrar DNS is external.

## Related

[projects.md](./projects.md) · [../cli/reference.md](../cli/reference.md)
