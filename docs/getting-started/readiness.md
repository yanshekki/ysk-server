# Production readiness

> Language: English | [中文](./readiness-ZH.md)

```bash
ysk-server readiness --data-dir … --json
ysk-server doctor --json   # alias
```

HTTP readiness may return 503 when not production-ready but still includes the full report (not a fake OK).

Panel: `/system/readiness`.
