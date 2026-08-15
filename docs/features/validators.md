# Feature: Validators (Beta)

> Language: English | [中文](./validators-ZH.md)

## Purpose

Install and manage **L1 validator-ready nodes** (Ethereum, Avalanche, NEAR, Cardano, plus Phase 2: Bitcoin, Cosmos Hub, Sui, Aptos, Polkadot, Solana) on this single host. The panel prepares software and config. **You keep the keys.**

**Non-goals:** Key custody, automatic staking, archive nodes, guaranteed yield.

## Panel

| Item | Value |
|------|--------|
| Route | `/validators` |
| Nav key | `validators` |
| Main tabs / actions | Nodes · Disk · About |
| Capability | `validators.read` (list) · `validators.manage` (mutate, later) · `validators.wipe` (clear, later) |
| RBAC | Viewer can list; operator can manage; admin can wipe |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| List instances | `ysk-server validators list --json` | read | |
| Supported chains | `ysk-server validators chains --json` | read | |
| Disk usage | `ysk-server validators disk --json` | read | |
| Get instance | `ysk-server validators get --id ID --json` | read | |
| Create / install | `ysk-server validators create --chain … --network … --execute --json` | write-host | Dry-run writes spec; apply needs Docker Compose. ETH accepts `--el` / `--cl`. Missing Docker → panel banner to `/docker` |
| Mithril restore | `ysk-server validators mithril --id ID --confirm MITHRIL --execute --json` | write-host | Cardano only; certified snapshot, no keys |
| Upgrade | `ysk-server validators upgrade --id ID --execute --json` | write-host | Health-checks then rolls back the previous image on failure |
| Prune / switch network / snapshot | `validators prune` · `switch-network` · `snapshot` | write-host | Switch requires stop + confirm (clears data) |
| Start / stop / restart | `ysk-server validators start\|stop\|restart --id ID --execute --json` | write-host | |
| Clear chain data | `ysk-server validators clear --id ID --confirm --execute --json` | write-host | Confirm = id or `CLEAR` |

Risk: `read` · `write-panel` · `write-host` (see [docs-standard.md](../docs-standard.md)).

## CLI quick start

```bash
ysk-server validators list --json
ysk-server validators chains --json
ysk-server validators disk --json
ysk-server validators get --id eth-hoodi-1 --json
```

Full argv: [../cli/reference.md](../cli/reference.md).

## Honesty

- Without `--execute`, host-mutating commands stay **dry-run**.  
- Real apply still needs `YSK_EXECUTE=1` (and often root).  
- **written** (data dir) ≠ **applied** (live host).  
- Create without `--execute` is **written** (spec + compose). Start / stop / clear stay **blocked**.

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| About tab | Operator help; CLI has `--help` / docs |

## Related

- [Panel ↔ CLI matrix](../cli/panel-parity-matrix.md)  
- [CLI reference](../cli/reference.md)  
- [Ops honesty](../architecture/ops-honesty.md)  
- [Original design notes](../_archive/validators-design.md)  
