# YSK Server — Multi-Chain L1 Validator / Node Manager Feature Design

> **Target repo**: https://github.com/yanshekki/ysk-server  
> **Feature name**: `validators` (UI nav) / `blockchain-nodes` (internal)  
> **Version target**: integrate into ysk-server ≥ 1.1.x  
> **Author intent**: One-click install / update / clear / manage validator-ready nodes for multiple L1s, fully controllable from the existing web panel + CLI + API. Supports **Testnet + Mainnet**. Designed for both development/testing and production use, with strong safety around disk, keys, and root operations.

---

## 1. Goals & Non-Goals

### Goals
- One-click **Install / Start / Stop / Restart / Update / Clear (wipe data) / Status** for supported L1 nodes.
- **Automatic upgrade** support (client binaries / Docker images) with configurable policies.
- Support both **Testnet** and **Mainnet** (user must explicitly choose; mainnet has stronger warnings).
- Full control from **Web UI** (primary), **CLI** (`ysk-server validators ...`), and **HTTP API**.
- Storage-aware: disk monitoring, aggressive pruning options, one-click clear + optional snapshot restore.
- Non-custodial by default: platform prepares the *node software + config*, user handles keys & staking.
- Extensible plugin-style chain adapters so new L1s can be added later.
- Fits existing ysk-server patterns: `YSK_EXECUTE=1` for mutations, honest feedback, metrics, logs, terminal integration.
- **Full i18n alignment** with ysk-server supported locales. Chinese **must** use Hong Kong written Chinese (zh-HK / 香港書面語).

### Non-Goals (v1)
- Automatic staking / key generation with custody of private keys.
- Multi-tenant shared nodes across different users.
- Full archive nodes by default (too heavy).
- Guaranteed mainnet profitability or zero-slash operation (user responsibility).

---

## 2. Supported Chains (Priority Order)

### Phase 1 (Must ship)
| Chain | ID | Testnets | Mainnet | Notes |
|-------|----|----------|---------|-------|
| **Ethereum** | `eth` | Hoodi, Sepolia | mainnet | EL + CL pair. Support Geth/Nethermind/Reth + Lighthouse/Prysm/Teku/Nimbus. Pruned / minimal modes. |
| **Avalanche** | `avax` | Fuji | mainnet | AvalancheGo. State-sync + pruning. Primary Network focus. |
| **Cardano** | `ada` | Preview, Preprod | mainnet | cardano-node (relay + optional block producer mode). Mithril snapshot support. |
| **NEAR** | `near` | testnet | mainnet | neard. RPC vs Validator config profiles. |

### Phase 2 (Recommended next)
| Chain | ID | Why |
|-------|----|-----|
| **Bitcoin** | `btc` | Pruned full node is very practical on limited disk. |
| **Cosmos Hub / generic Cosmos SDK** | `cosmos` / `cosmos-*` | Easy state-sync pattern, many chains share tooling. |
| **Sui** | `sui` | Growing, relatively clean binary. |
| **Aptos** | `aptos` | Similar to Sui. |
| **Polkadot / Substrate** | `dot` | Optional later. |
| **Solana** | `sol` | Only if disk ≥ 2TB+ and high IOPS; mark as “heavy”. |

Design the adapter interface so Phase 2 can be added without rewriting core.

---

## 3. Architecture Integration

### Directory Layout (proposed)

```
apps/server/src/
  features/
    validators/                  # or blockchain-nodes/
      index.ts
      types.ts
      registry.ts                # chain registry
      manager.ts                 # core orchestrator
      disk-monitor.ts
      snapshot.ts
      adapters/
        eth.ts
        avax.ts
        ada.ts
        near.ts
        base.ts                  # abstract adapter
      routes.ts                  # HTTP API
      cli.ts                     # CLI subcommands

apps/web/src/features/
  validators/
    index.ts
    ui/
      ValidatorsPage.tsx
      ChainCard.tsx
      NodeActions.tsx
      DiskPanel.tsx
      LogsDrawer.tsx
      CreateNodeWizard.tsx
    model/
      types.ts
      api.ts
      store.ts
    guides/
      ...
```

Follow existing feature patterns (`software`, `runtimes`, `pm2`, `system`, `updates`).

### Core Concepts

- **Node Instance**: A configured + running (or stopped) node for one chain + network (e.g. `eth-hoodi-1`, `avax-fuji-default`).
- **Adapter**: Per-chain implementation of install, start, stop, update, clear, status, prune, getLogs, etc.
- **Profile**: `rpc` | `validator-ready` | `minimal` | `pruned` (chain-specific).
- **Data Dir**: Isolated under e.g. `/var/lib/ysk-server/validators/<instance-id>/` or user-configurable.

All mutations require `YSK_EXECUTE=1` (same honesty model as the rest of the panel).

---

## 4. One-Click Actions (Core)

Every instance must support:

| Action | Description | Safety |
|--------|-------------|--------|
| **Install** | Download binaries / Docker image, create config, systemd unit or Docker Compose, data dir | Dry-run first |
| **Start** | Start the node process / containers | Check ports & disk |
| **Stop** | Graceful stop | — |
| **Restart** | Stop + Start | — |
| **Update / Upgrade** | Pull latest supported client version(s), restart. Supports manual one-click and automatic policies | Backup config first; health-check after; optional rollback |
| **Clear / Wipe** | Stop → delete data directory (chain data only) → optional auto-restore from snapshot | Strong confirmation + “I understand this deletes chain data” |
| **Status** | Running?, sync progress, peers, version, disk usage, last error | — |
| **Logs** | Tail / stream logs (integrate with existing terminal / log viewer) | — |
| **Prune** | Trigger client-native pruning if available | Chain-specific |

Additional useful actions:
- **Export Config**
- **Open Terminal** (into the node’s working dir or container)
- **Check Disk Headroom**
- **Switch Network** (testnet ↔ mainnet) — only when stopped + clear data

---

## 5. UI Design (Web Panel)

### Navigation
Add under main nav (or under “Ops” / “Software”):
- **Validators (Beta)** / **L1 Nodes (Beta)**
  - zh-HK：**驗證者節點 (Beta)** 或 **L1 節點 (Beta)**
  - en：Validators (Beta) / L1 Nodes (Beta)
  - zh-CN：验证者节点 (Beta) / L1 节点 (Beta)
- The **(Beta)** suffix is **mandatory** in v1 for all locales. Only remove it after the feature is considered stable and no longer experimental.

### Main Page Layout
1. **Header**
   - Title + short description
   - “Create Node” button
   - Global disk usage summary for `/var/lib/ysk-server/validators`

2. **Instance Cards / Table**
   - Chain icon + name
   - Network badge (Testnet = green/blue, Mainnet = orange/red warning)
   - Status (Running / Syncing / Stopped / Error)
   - Sync % or “Synced”
   - Disk used
   - Quick actions: Start / Stop / Restart / Clear / Logs / More

3. **Create / Edit Wizard**
   - Step 1: Choose Chain
   - Step 2: Choose Network (Testnet recommended by default)
   - Step 3: Profile (Minimal / Pruned / Validator-ready)
   - Step 4: Client selection (where multiple exist, e.g. ETH)
   - Step 5: Advanced (ports, data path, resource limits, pruning flags)
   - Step 6: Review + Install

4. **Detail Drawer / Page**
   - Real-time status, metrics (CPU/RAM/Disk/Network of the process)
   - Logs streaming
   - Config editor (read-only or controlled)
   - One-click Clear with confirmation modal
   - Snapshot restore option
   - “Prepare for Staking” checklist (non-custodial guidance)

5. **Disk Panel** (important for 100GB machines)
   - Per-instance usage
   - Global free space
   - Warning thresholds (yellow 70%, red 85%)
   - “Auto-clear when low” toggle (optional, default off)
   - One-click “Clear oldest / largest instance”

### Localization (i18n) — Mandatory Alignment

**Must fully align with ysk-server’s existing locale system.**

- **Default / primary Chinese**: `zh-HK`（香港書面語 / 繁體中文・香港）
  - 所有中文 UI 文案、提示、錯誤訊息、指南、確認對話框 **必須** 使用香港書面語。
  - 禁止使用台灣用語習慣、簡體中文混雜、或大陸書面語作為主要中文版本。
  - 範例用語：伺服器、檔案、電郵、資料庫、網絡、設定、啟動、停止、清空、升級、驗證者節點 等（與現有 README-ZH.md 及面板風格一致）。
- **Other required locales** (at minimum, match whatever ysk-server currently ships):
  - `en` (English)
  - `zh-CN` (简体中文) — secondary Chinese, keep consistent terminology where possible
  - Any additional locales already present in ysk-server (`and more` as stated in the main README)
- Implementation rules:
  - Re-use the project’s existing i18n / locale loading mechanism (do **not** invent a parallel system).
  - All new keys for the validators feature must be added to every supported locale file.
  - Missing translation fallback order should follow the host project’s existing behaviour (usually zh-HK → en).
  - CLI help text and JSON error messages should also respect `--locale` / current locale.
  - Screenshots / docs examples for this feature should include zh-HK versions.

---

## 6. Special / Differentiating Features

These make the feature more than a simple Docker wrapper:

1. **Storage-First Design**
   - Pre-flight disk check before install.
   - Per-chain recommended minimum free space (shown in UI).
   - Aggressive “minimal / pruned” profiles enabled by default on low-disk hosts.
   - One-click Clear is first-class, with optional automatic snapshot-based rebuild.

2. **Snapshot / Fast Bootstrap Helper**
   - For chains that support it (ETH snapshots, AVAX state-sync, Cardano Mithril, NEAR snapshots):
     - “Restore from official / community snapshot” button.
     - Configurable trusted snapshot sources.

3. **Validator-Ready Checklist (Non-Custodial)**
   - After node is synced, show a checklist:
     - Keys generated offline?
     - Deposit / registration done?
     - Withdrawal credentials set?
     - Monitoring / alerts configured?
   - Links to official launchpads / docs.
   - Never store or transmit private keys.

4. **Multi-Instance Support**
   - Multiple nodes of the same chain (e.g. one Hoodi + one Sepolia, or multiple test validators).

5. **Resource Limits**
   - cgroup / Docker resource limits (CPU, memory) per instance.
   - Nice integration with existing metrics.

6. **Automatic Upgrade (一鍵／自動升級) — First-class feature**
   - Must support both **manual one-click upgrade** and **automatic upgrade policies**.
   - Per-instance (or global default) upgrade policy options:
     | Policy | Behaviour |
     |--------|-----------|
     | `manual` | Only upgrade when user clicks “Upgrade” (default for Mainnet) |
     | `notify` | Check periodically, show badge / notification in panel, user decides |
     | `auto-safe` | Automatically upgrade only on **patch / minor** releases that are marked safe by the adapter; skip major / breaking |
     | `auto-all` | Automatically upgrade whenever a newer supported version is available (recommended only for Testnet) |
   - Upgrade flow must:
     - Detect newer client version(s) from official release sources / Docker tags.
     - Show changelog summary or link when available.
     - Backup current config before upgrading.
     - Stop node → pull new binary/image → apply config migration if needed → start → verify health.
     - Support dry-run.
     - Roll back to previous version if health check fails after upgrade (best-effort).
   - Scheduled check (cron / internal timer) integrated with existing ysk-server ops / updates facilities where possible.
   - UI: clear “Upgrade available” badge on instance cards + dedicated Upgrade button + policy selector in settings.
   - CLI: `ysk-server validators upgrade <id> [--dry-run]` and policy management commands.
   - Respect chain-specific compatibility (e.g. ETH EL+CL version matrix).

7. **Port & Firewall Helper**
   - Automatically suggest / open required P2P + RPC ports via existing security / network features.

8. **Health & Alerting Hooks**
   - Expose status to existing metrics / readiness endpoints.
   - Optional webhook / notification when node falls behind or disk critical.

9. **CLI + AI Agent Friendly**
   - Full CLI parity so Grok / other agents can script everything.
   - JSON output modes.

10. **Dry-Run Everywhere**
    - All destructive or install actions support dry-run (consistent with YSK_EXECUTE model).

---

## 7. Safety & Disk Policy (Critical)

Given the earlier discussion about 100GB machines:

- **Default recommendation**: Testnet + Minimal/Pruned profiles.
- Mainnet install must show a strong warning + required free space (e.g. ETH ≥ 800GB recommended, etc.).
- Clear action:
  - Requires typing the instance name or “CLEAR”.
  - Option: “Also remove systemd unit / Docker compose”.
  - Option: “Immediately re-bootstrap from snapshot after clear”.
- Background disk monitor that can pause non-critical instances or alert when free space < threshold.
- Never auto-clear without explicit user opt-in.

---

## 8. Security Model

- All host changes go through the existing root + `YSK_EXECUTE=1` gate.
- Data directories owned by a dedicated system user if possible (or root with clear documentation).
- RPC ports bound to localhost by default; user must explicitly expose.
- No private keys or seed phrases ever written by the panel.
- Config files may contain public keys / node IDs only.
- Audit log of all Install / Clear / Update actions.

---

## 9. API Surface (Sketch)

```
GET    /api/validators                     # list instances
POST   /api/validators                     # create / install
GET    /api/validators/:id                 # status + details
POST   /api/validators/:id/start
POST   /api/validators/:id/stop
POST   /api/validators/:id/restart
POST   /api/validators/:id/update
POST   /api/validators/:id/clear           # body: { confirm: true, restoreSnapshot?: bool }
GET    /api/validators/:id/logs
GET    /api/validators/chains              # supported chains + networks + profiles
GET    /api/validators/disk                # global + per-instance usage
```

CLI examples:
```bash
ysk-server validators list
ysk-server validators create --chain eth --network hoodi --profile minimal
ysk-server validators start <id>
ysk-server validators clear <id> --confirm --restore-snapshot
ysk-server validators status <id> --json
```

---

## 10. Implementation Phases

### Phase 0 — Foundation
- Types, registry, base adapter, disk monitor, routes/CLI stubs, empty UI page.

### Phase 1 — Ethereum (highest priority)
- Support Hoodi + Sepolia + mainnet.
- At least one EL + one CL combination (recommend Reth or Nethermind + Lighthouse for modern minimal footprint).
- Install via Docker Compose (preferred for isolation) or native binaries.
- Clear + basic status + logs.

### Phase 2 — Avalanche + NEAR
- Fuji / mainnet for AVAX, testnet / mainnet for NEAR.
- State-sync and pruning emphasis.

### Phase 3 — Cardano
- Preview / Preprod / mainnet.
- Mithril snapshot integration for fast bootstrap.
- Relay-first; block-producer mode as advanced.

### Phase 4 — Polish + Extra Chains
- Bitcoin pruned, generic Cosmos, better snapshot sources, auto-update policies, deeper metrics, mobile-friendly UI tweaks.

---

## 11. Technical Preferences

- **Container-first** where possible (Docker / Docker Compose) for isolation and easy clear.
- Fall back to systemd + native binaries when containers are unsuitable.
- Re-use existing ysk-server facilities: terminal, logs, metrics, file manager, firewall helpers, updates.
- Prefer official or well-known community Docker images / release binaries.
- Version pinning + clear “supported client versions” matrix per chain.
- All long-running operations should stream progress (install, sync, clear, update).

---

## 12. Acceptance Criteria (v1)

- [ ] User can create an Ethereum Hoodi node in ≤ 5 clicks from the panel.
- [ ] One-click Clear deletes chain data and returns disk space (observable in UI).
- [ ] Status shows sync progress and disk usage.
- [ ] CLI can perform the same actions as UI.
- [ ] Mainnet creation shows strong warning and checks free space.
- [ ] No private keys are generated or stored by the feature.
- [ ] Feature appears in nav as **「驗證者節點 (Beta)」** (and equivalent in other locales) and follows existing design system.
- [ ] **i18n**: All UI strings exist for every locale that ysk-server supports; Chinese uses **zh-HK 香港書面語** as the primary Chinese locale.
- [ ] **Automatic upgrade**: At least `manual` + `notify` policies work; `auto-safe` / `auto-all` implemented for testnet; upgrade flow includes backup + health check.
- [ ] Dry-run works; real mutations require `YSK_EXECUTE=1`.
- [ ] Basic logs are viewable from the panel.
- [ ] At least ETH + one other chain (AVAX or NEAR) fully working on testnet.

---

## 13. Future Ideas (Backlog)

- One-click “validator client only” mode that connects to a remote beacon/full node.
- Integration with existing backup system for config + keystore paths (user-supplied).
- Cost estimator (disk growth projection).
- Multi-server orchestration (later, if ysk-server gains multi-host).
- Plugin marketplace for community chain adapters.

---

## 14. Reference Notes for Implementers

- Existing feature examples to copy patterns from: `software`, `runtimes`, `pm2`, `updates`, `system`.
- Honest execution model must be preserved.
- Prefer progressive enhancement: start with Docker Compose templates per chain.
- For low-disk hosts, force or strongly recommend Testnet + Minimal profiles.
- Document required free space per chain/profile in the UI and in `docs/`.

---

**End of Design Document**

This document is intended to be used directly by Grok (or human developers) as the specification for implementing the `validators` feature inside ysk-server. Update this file as implementation decisions are finalized.
