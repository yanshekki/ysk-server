# Operator manual

> Language: English | [中文](./manual-ZH.md)

Day-1…N path for a single production host. Full map: [../INDEX.md](../INDEX.md).  
Doc standard: [../docs-standard.md](../docs-standard.md).

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
Handbook: [../features/security-auth.md](../features/security-auth.md).

## 3. First site

```bash
export YSK_EXECUTE=1   # as root for systemd/nginx
ysk-server projects create --name demo --domain demo.example.com --runtime node --json
ysk-server projects deploy --id <UUID> --execute --json
ysk-server nginx sync --execute --json
```

Details: [../features/projects.md](../features/projects.md).

## 4. DNS / SSL / Nginx

```bash
ysk-server dns zones --json
ysk-server ssl list --json
ysk-server nginx status --json
```

Publish A/AAAA at your provider.  
[../features/dns-ssl-nginx.md](../features/dns-ssl-nginx.md)

## 5. Optional mail

```bash
ysk-server email bootstrap --domain example.com --ip YOUR_IP --json
ysk-server email deliverability --domain example.com --json
ysk-server email aliases list --domain example.com --json
```

You must set **PTR** and open **Port 25** (or relay) yourself.  
[../features/email.md](../features/email.md)

## 6. Databases & Redis

```bash
ysk-server db status --json
ysk-server redis status --json
ysk-server db sql-engine preview --target mariadb --json
```

[../features/databases.md](../features/databases.md)

## 7. VPN / VNC (optional)

```bash
ysk-server vpn status --json
ysk-server vnc status --json
# host mutations need YSK_EXECUTE=1 + --execute
```

[../features/vpn.md](../features/vpn.md) · [../features/vnc.md](../features/vnc.md)

## 8. Network exposure, Real-IP, panel TLS

```bash
ysk-server network exposure list --json
ysk-server real-ip status --json
ysk-server ssl panel-tls status --json
```

[../features/system-host.md](../features/system-host.md)

## 9. Updates & software

```bash
ysk-server updates inventory --json
ysk-server software list --json
ysk-server update --check --json
```

## 10. Defense & backup

```bash
ysk-server defense status --json
ysk-server backup schedule --install --execute
ysk-server readiness --json
```

## 11. Daily ops

| Task | Command / UI |
|------|----------------|
| Readiness | `readiness --json` / System → Readiness |
| Logs | `logs query …` / Log Center |
| Host packages | `updates inventory` |
| Product self-update | `update --check` |
| Sessions / keys | `security sessions` · `security api-keys` |
| FTP | `ftp accounts list` |
| Runtimes | `runtimes list` |

## Safety reminders

- Dry-run default on host mutations.  
- `written` ≠ `applied`.  
- Fail-closed without EXECUTE/root is normal.  
- Panel-only surfaces: terminal PTY, VNC canvas, Host Browse, file preview.

Full CLI: [../cli/reference.md](../cli/reference.md).  
Parity: [../cli/panel-parity-matrix.md](../cli/panel-parity-matrix.md).
