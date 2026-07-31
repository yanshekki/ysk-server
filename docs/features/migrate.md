# Host migrate

> Language: English | [中文](./migrate-ZH.md)

**Panel / CLI:** migrate UI · `ysk-server migrate`

## What it does

Move control-plane + site state between hosts in **phases**. Each phase returns honest JSON; nothing is silently half-applied.

| Phase | Purpose |
|-------|---------|
| `inventory` | Snapshot projects, packages, paths, versions |
| `host` | Transfer / apply on target (EXECUTE/root as needed) |
| `post` | Post-checks, DNS/SSL reminders |
| `status` / `resume` | Inspect or continue after stop/fail |

## CLI

```bash
ysk-server migrate inventory --json
ysk-server migrate host --json          # review plan; use --execute when ready
ysk-server migrate post --json
ysk-server migrate status --json
ysk-server migrate resume --json
```

## Operator checklist

1. `backup control-plane` + project backups on source.  
2. Run `inventory` and archive the JSON.  
3. Prepare target: same major product version, disk, `YSK_EXECUTE`.  
4. Run `host` dry-run first, then `--execute`.  
5. `post` + `readiness` on target.  
6. Cut DNS only after health OK.

## Honesty

- Fail-closed mid-phase: re-run `status` / `resume`, do not assume success.  
- Live OS users / nginx / mail still need root+EXECUTE on the target.

## Related

[../cli/reference.md](../cli/reference.md) · [../deploy/host-migrate.md](../deploy/host-migrate.md) · [projects.md](./projects.md)
