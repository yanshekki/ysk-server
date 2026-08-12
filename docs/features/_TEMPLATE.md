# Feature: &lt;Domain name&gt;

> Language: English | [中文](./_TEMPLATE-ZH.md)

> **Template only** — copy to `<domain>.md` / `<domain>-ZH.md` and replace placeholders.  
> Do not leave `_TEMPLATE` linked from INDEX as a product page.

## Purpose

&lt;One sentence: what this domain does on the single-host control plane.&gt;

**Non-goals:** &lt;What this is not.&gt;

## Panel

| Item | Value |
|------|--------|
| Route | `/path` |
| Nav key | `navKey` |
| Main tabs / actions | &lt;list&gt; |
| Capability | `capability.id` |
| RBAC | &lt;who can use&gt; |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| View status | `ysk-server … status --json` | read | |
| Apply / mutate | `ysk-server … --execute --json` | write-host | Needs `YSK_EXECUTE=1`, often root |

Risk: `read` · `write-panel` · `write-host` (see [docs-standard.md](../docs-standard.md)).

## CLI quick start

```bash
# Read-only
ysk-server <cmd> status --json

# Host mutation (plan first, then execute)
ysk-server <cmd> … --json
export YSK_EXECUTE=1
ysk-server <cmd> … --execute --json
```

Full argv: [../cli/reference.md](../cli/reference.md).

## Honesty

- Without `--execute`, host-mutating commands stay **dry-run**.  
- Real apply still needs `YSK_EXECUTE=1` (and often root).  
- **written** (data dir) ≠ **applied** (live host).  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| &lt;none or name&gt; | &lt;why CLI cannot replace it&gt; |

## Related

- [Panel ↔ CLI matrix](../cli/panel-parity-matrix.md)  
- [CLI reference](../cli/reference.md)  
- [Ops honesty](../architecture/ops-honesty.md)  
