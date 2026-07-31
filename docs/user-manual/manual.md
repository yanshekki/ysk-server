# Operator manual

> Language: English | [中文](./manual-ZH.md)

Day-1 path for a single production host. Prefer [../INDEX.md](../INDEX.md) for the full map.

## 1. Install & setup

```bash
pnpm install && pnpm build
ysk-server setup --data-dir /var/lib/ysk --admin-password 'StrongPass!' --locale en --json
ysk-server serve --data-dir /var/lib/ysk
```

See [../getting-started/install.md](../getting-started/install.md) · [setup.md](../getting-started/setup.md).

## 2. Secure the panel

1. Login → change password if bootstrap was weak.  
2. Enable **panel 2FA** (Security).  
3. Prefer listen `127.0.0.1` + reverse proxy / SSH tunnel.  
4. Optional: `security.require_admin_totp`.  

CLI: `ysk-server security status --json`.

## 3. First site

```bash
export YSK_EXECUTE=1   # as root for systemd/nginx
ysk-server projects create --name demo --domain demo.example.com --runtime node --json
ysk-server projects deploy --id <UUID> --execute --json
ysk-server nginx sync --execute --json
```

Details: [../features/projects.md](../features/projects.md).

## 4. DNS / SSL

- Publish A/AAAA (and mail records if needed) at your DNS provider.  
- Upload or obtain certificates; bind in nginx/SSL pages.  
- [../features/dns-ssl-nginx.md](../features/dns-ssl-nginx.md)

## 5. Optional mail

```bash
ysk-server email bootstrap --domain example.com --ip YOUR_IP --json
ysk-server email deliverability --domain example.com --json
```

You must set **PTR** and open **Port 25** (or relay) yourself.  
[../features/email.md](../features/email.md)

## 6. Defense & backup

```bash
ysk-server defense status --json
ysk-server backup schedule --install --execute
ysk-server readiness --json
```

## 7. Daily ops

| Task | Command / UI |
|------|----------------|
| Readiness | `readiness --json` / System → Readiness |
| Logs | `logs query …` / Log Center |
| Updates | `update --check` |
| Sessions / keys | `security sessions` · `security api-keys` |

## Safety reminders

- Dry-run default on host mutations.  
- `written` ≠ `applied`.  
- Fail-closed without EXECUTE/root is normal.

Full CLI: [../cli/reference.md](../cli/reference.md).
