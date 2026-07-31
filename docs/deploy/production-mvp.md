# Production MVP

> Language: English | [中文](./production-mvp-ZH.md)

Minimum for a real host: root + `YSK_EXECUTE=1`, nginx + node on PATH, admin 2FA, readiness green, backup schedule.

```bash
export YSK_EXECUTE=1
ysk-server readiness --json
```

See [../getting-started/go-live.md](../getting-started/go-live.md).
