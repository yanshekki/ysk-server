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
| Delete instance | `ysk-server validators delete --id ID --confirm --execute --json` | write-host | Stops Compose, wipes data, removes the record. Confirm = id or `CLEAR`. Needs `validators.wipe` |
| Staking credentials / next steps | `ysk-server validators checklist --id ID --json` | read | Same payload as `GET /api/v1/validators/:id/checklist`. Public identity only. |
| Rewrite generated compose | `ysk-server validators rewrite-compose --id ID --execute --json` | write-host | Regenerates official yaml (host P2P in `public_addr`). Dry-run without `--execute`. |
| Save compose YAML | `ysk-server validators compose-write --id ID --file PATH --execute --json` | write-host | Same as `PUT /compose`. Body must mention `ysk-server validators` or the instance id. |
| Software pins | `ysk-server validators software [--refresh] --json` | read | Local vs pin vs official tag. |
| Pull pin image | `ysk-server validators pull --image IMAGE --tag TAG --execute --json` | write-host | Allowlisted pins / cached official tags only. |
| Remove leftover dir | `ysk-server validators leftover-remove --path PATH --confirm NAME --execute --json` | write-host | Confirm = directory basename. Needs root + execute. |
| Container stats | `ysk-server validators stats --id ID --json` | read | `docker stats --no-stream` for that compose project. |
| Official versions | `ysk-server validators versions --client ID [--refresh] --json` | read | GitHub list + pin. |
| Pin a client tag | `ysk-server validators set-version --id ID --client ID --tag TAG --confirm ID --execute --json` | write-host | Recreates compose. |
| Cardano producer keys | `ysk-server validators producer-keys --id ID --kes-file P --vrf-file P --opcert-file P --confirm ID --execute --json` | write-host | Hot keys only. `producer-detach` to remove. |
| NEAR set pool account_id | `ysk-server validators near-account --id ID --pool-slug NAME --confirm ID --execute --json` | write-host | Writes `account_id` only. Dry-run without `--execute`. Optional `--restart`. |
| Settings | `ysk-server validators settings [--auto-clear 0\|1] --json` | write-panel | auto-clear leftover ranking. |

Risk: `read` · `write-panel` · `write-host` (see [docs-standard.md](../docs-standard.md)).

## CLI quick start

```bash
ysk-server validators list --json
ysk-server validators chains --json
ysk-server validators disk --json
ysk-server validators get --id eth-hoodi-1 --json
ysk-server validators create --chain eth --network hoodi --profile minimal --json
YSK_EXECUTE=1 ysk-server validators create --chain eth --network hoodi --profile minimal --execute --json
```

Full argv: [../cli/reference.md](../cli/reference.md).

## Honesty

- Without `--execute`, host-mutating commands stay **dry-run**.  
- Real apply still needs `YSK_EXECUTE=1` (and often root).  
- **written** (data dir) ≠ **applied** (live host).  
- Create without `--execute` is **written** (spec + compose). Start / stop / clear stay **blocked**.  
- **NEAR:** the staking-pool contract stores this node’s `public_key`, not the server IP. Peers use `public_addr` on the **host P2P port** (`ports.p2p`, often 24567). RPC stays on localhost. The instance form fills `create_staking_pool` and can write **only** `account_id` on existing `validator_key.json`. It never writes `secret_key`, never wallet-connects, and never broadcasts the factory transaction. RPC not ready is not the same as missing keys. Instances created before this compose change still advertise container port 24567 until you rewrite compose.  
- **After the node is up:** the instance page lists numbered next steps and “do not” lines.  
  - AVAX: NodeID + BLS after RPC answers. P-Chain registration in Core uses those values, not the server IP.  
  - NEAR: stake public key, factory, form-filled `create_staking_pool` (disk; not RPC). After the pool exists, set `account_id` on this page.  
  - Cosmos: consensus public key, `chain-id`, form-filled `validator.json` + `gaiad tx staking create-validator validator.json` (amount, moniker, `--from`). This node is **gaiad v28** (JSON file). Hub docs still show flags — those fail here. Gas is `0.005uatom` to match the node — not the Hub docs’ `0.0025uatom` example. The panel does not broadcast. Peers use host P2P (`tcp://WAN:{p2p}`).  
  - ETH: execution + beacon only — no validator client. Copy the localhost beacon URL. If the CL is Lighthouse, also copy `lighthouse vc --beacon-nodes`. Other CLs: point your own VC at that URL. Hoodi instances link the Hoodi launchpad only. Putting a keystore in the beacon datadir does not attest.  
  - Solana: `--no-voting`; identity pubkey from `getIdentity`. Creating a vote account does not make this process vote.  
  - Polkadot: full node, no `--validator`; the panel does not call `rotateKeys`.  
  - Sui / Aptos: fullnode / public fullnode, not a validator process.  
  - Cardano: relay first; hot keys on this page. Public advertise is the pool **registration certificate** (`--pool-relay-ipv4` or DNS + P2P port), not `topology.json`. `topology.json` `localRoots` is for your own block producer (`advertise: false`). The panel does not probe WAN.  
  - `validator-ready` is a disk profile, not “this process is already validating”.

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| About tab | Operator help; CLI has `--help` / docs |
| NetIO live poll | List page graph. `validators list` summaries already include last rx/tx when Docker answers |
| Compose YAML editor | Interactive editor; save is `compose-write` |
| Cosmos create-validator form | Fills copyable `validator.json` + gaiad v28 command (amount, moniker, `--from`). Nothing is written on the host; no CLI. |
| ETH validator-client example | Lighthouse: copyable `lighthouse vc --beacon-nodes`. Other CLs: copy the beacon URL. Compose has no VC. |

## Related

- [Panel ↔ CLI matrix](../cli/panel-parity-matrix.md)  
- [CLI reference](../cli/reference.md)  
- [Ops honesty](../architecture/ops-honesty.md)  
- [Original design notes](../_archive/validators-design.md)  
