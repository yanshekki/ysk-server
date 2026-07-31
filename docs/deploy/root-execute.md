# root & YSK_EXECUTE

> Language: English | [中文](./root-execute-ZH.md)

**Purpose:** Define when the control plane may change the real host.

## Rules

| Condition | Result |
|-----------|--------|
| `YSK_EXECUTE` unset | Host mutations blocked or dry-run only |
| EXECUTE, non-root | Many ops still blocked (useradd, system conf, apt) |
| root + EXECUTE | Full apply path available |

## CLI pattern

```bash
export YSK_EXECUTE=1
ysk-server <mutating-cmd> --json           # dry-run plan
ysk-server <mutating-cmd> --execute --json # real attempt
```

Also requires product flags like `--install` where documented.

## Related

[real-ops.md](./real-ops.md) · [../architecture/ops-honesty.md](../architecture/ops-honesty.md)
