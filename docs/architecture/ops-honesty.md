# Ops honesty

> Language: English | [中文](./ops-honesty-ZH.md)

YSK never pretends a host change succeeded when it only wrote a plan or a file under `dataDir`.

## Apply status

Canonical types live in `ysk-server-shared` (`OpsResultDto` / `ApplyStatus`).

| Status | Meaning |
|--------|---------|
| `draft` | Row only in control plane |
| `written` | Managed file written under dataDir; **not** live system |
| `applied` | Host command / reload succeeded |
| `blocked` | Needs EXECUTE and/or root |
| `failed` | Attempted and failed |
| `partial` | Mixed steps |

**Forbidden:** `ok: true` with `blocked: true`, or `applied` when blocked.

## CLI contract

| Exit | Meaning |
|------|---------|
| 0 | OK (including valid dry-run plan) |
| 1 | Error |
| 2 | Validation |
| 3 | Blocked |
| 4 | Not found |
| 5 | Host command error |

Dangerous ops: default **dry-run**; pass `--execute` (or `--apply`) **and** set `YSK_EXECUTE=1`.

## Operator checklist

1. Read `notes` / `blockMessage` in JSON.  
2. Confirm `dryRun` / `executed` / `applyStatus`.  
3. Run `ysk-server readiness --json` before go-live.  

See also: [../deploy/root-execute.md](../deploy/root-execute.md) · [../deploy/real-ops.md](../deploy/real-ops.md).
