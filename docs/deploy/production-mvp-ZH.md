# 生產 MVP

> 語言：中文 | [English](./production-mvp.md)

真實主機最低要求：root + `YSK_EXECUTE=1`、PATH 有 nginx + node、管理員 2FA、readiness 達標、備份排程。

```bash
export YSK_EXECUTE=1
ysk-server readiness --json
```

見 [../getting-started/go-live-ZH.md](../getting-started/go-live-ZH.md)。
