# Real ops vs degraded

> Language: English | [中文](./real-ops-ZH.md)

## Modes

| Mode | When | Behaviour |
|------|------|-----------|
| Degraded | No root or no EXECUTE | Manage dataDir; refuse fake applied |
| Production-capable | root + EXECUTE + key binaries | readiness may pass |

Degraded is **intentional**.

```bash
ysk-server readiness --json
ysk-server host overview --json
```

## Related

[root-execute.md](./root-execute.md) · [../getting-started/readiness.md](../getting-started/readiness.md)
