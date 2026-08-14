# First-time setup

> Language: English | [中文](./setup-ZH.md)

```bash
ysk-server setup --data-dir /var/lib/ysk-server --admin-user admin --admin-password 'StrongPass!' --locale zh-HK --json
ysk-server serve --data-dir /var/lib/ysk-server
```

Creates `config.json`, document store, admin user, systemd unit template under dataDir.

Use strong passwords. Insecure defaults only with `YSK_ALLOW_INSECURE_DEFAULTS=1` (local dev).

## Next

[readiness.md](./readiness.md) · [../deploy/systemd.md](../deploy/systemd.md)
