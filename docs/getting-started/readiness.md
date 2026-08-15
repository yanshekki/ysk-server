# Production readiness

> Language: English | [中文](./readiness-ZH.md)

```bash
ysk-server readiness --data-dir … --json
ysk-server doctor --json   # alias
```

HTTP readiness may return 503 when not production-ready but still includes the full report (not a fake OK).

Leftover host files (Apache default site, missing nginx catch-all, failed vsftpd, Dovecot TLS to a missing cert, stale `~/.npm-global` CLI) appear as **degraded**, not healed. Overlay does not rewrite those files. CLI: `ysk-server hosting leftovers`.

Panel: `/system/readiness`.
