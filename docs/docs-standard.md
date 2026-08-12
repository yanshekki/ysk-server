# Documentation standard (Panel + CLI)

> Language: English | [中文](./docs-standard-ZH.md)

**Scope:** formal product docs under `docs/` and root `README*`.  
**Not in scope:** UI locale JSON (`packages/shared/locales`), archived notes (`docs/_archive/`).

---

## 1. Goals

1. Every **production panel capability** is described in a feature handbook.  
2. Every **CLI entry** is listed in the CLI reference with honest risk notes.  
3. **English** and **Hong Kong written Chinese** (`*-ZH.md`) stay structurally parallel.  
4. Operators and AI agents can go from task → panel path → CLI command without guessing.

---

## 2. Reader layers (write only what each layer needs)

| Layer | Audience | Primary files | Content |
|-------|----------|---------------|---------|
| **L0 Navigation** | Everyone | `INDEX.md`, `README.md` | Map + one-line honesty |
| **L1 Operator path** | Operators | `user-manual/manual.md` | Day-1…N flows, links to L2 |
| **L2 Feature handbook** | Operators / support | `features/<domain>.md` | Panel + CLI capability tables |
| **L3 CLI encyclopedia** | Operators / AI | `cli/overview.md`, `cli/reference.md` | Flags, exit codes, every top-level command |
| **L4 Machine catalog** | AI / CI | `agent/commands.json`, `cli/parity-inventory.json` | Machine-readable |
| **L5 Architecture / deploy** | Dev / SRE | `architecture/`, `deploy/` | Design & ops depth |

Do **not** paste full argv encyclopedias into L2. L2 links to L3 for full flag lists.

---

## 3. Source of truth

```
Code (CLI_COMMANDS + routes + FEATURE_SECTIONS)
        │
        ▼
cli-panel-parity.mjs  →  parity-inventory.json  →  panel-parity-matrix.md
        │
        ├─► features/*     (panel flows + CLI mapping table)
        ├─► cli/reference* (command encyclopedia)
        └─► agent/commands.json
```

| Concern | Authoritative source |
|---------|----------------------|
| Command exists? | `apps/server/src/cli.ts` `CLI_COMMANDS` + handlers / `cli/cmd-*.ts` |
| Panel nav item? | `apps/web/src/shared/nav/features.ts` |
| HTTP surface? | `apps/web/src/features/**/api.ts` + `apps/server/src/routes/*` |
| Gap status ✅/⚠️/❌ | `docs/cli/panel-parity-matrix.md` + inventory script |

---

## 4. Language

| Locale | Rules |
|--------|--------|
| **en** | Professional, concise, no marketing fluff. Keep command names, paths, flags in English. |
| **zh-HK written (`*-ZH.md`)** | **Hong Kong written Chinese** (香港書面語). No colloquial Cantonese chat style. Technical proper nouns may stay English (WireGuard, RFB) with a short Chinese gloss. |
| **Structure** | Same heading levels, same number of tables and fenced code blocks. Run `node scripts/docs-bilingual-check.mjs`. |

Header on every formal pair:

```markdown
> Language: English | [中文](./foo-ZH.md)
```

```markdown
> 語言：中文（香港書面語）| [English](./foo.md)
```

### Shared honesty vocabulary

| EN | ZH |
|----|-----|
| dry-run | 試跑／計劃模式（不改主機） |
| blocked | 已阻擋 |
| written | 已寫入（資料目錄） |
| applied | 已套用（主機生效） |
| EXECUTE / `YSK_EXECUTE=1` | 系統變更權限（環境變數） |
| `--execute` | 允許嘗試真實主機變更 |
| panel-only | 僅面板（互動介面） |

---

## 5. Feature handbook template (L2)

Every `docs/features/<domain>.md` + `-ZH.md` **must** include:

1. **Purpose** — one-sentence product definition + non-goals  
2. **Panel** — route(s), main tabs/actions, capability key, RBAC note  
3. **Capability matrix** — columns: Panel action | CLI | Risk (`read` / `write-panel` / `write-host`) | Notes  
4. **CLI quick start** — copy-paste examples with `--json`; host mutations mark `--execute`  
5. **Honesty** — dry-run, EXECUTE, root, written ≠ applied  
6. **Panel-only ⚠️** — if any (e.g. VNC canvas)  
7. **Related** — matrix, reference, deploy links  

Skeleton: [`features/_TEMPLATE.md`](./features/_TEMPLATE.md) · [`features/_TEMPLATE-ZH.md`](./features/_TEMPLATE-ZH.md).

Risk column meanings:

| Risk | Meaning |
|------|---------|
| `read` | No host mutation |
| `write-panel` | Control-plane data only |
| `write-host` | Needs `--execute` + usually `YSK_EXECUTE=1` and root |

---

## 6. CLI reference rules (L3)

For each **top-level** command in `CLI_COMMANDS`:

- One H2 section  
- Purpose (one line)  
- Subcommand table (sub | purpose | needs `--execute`?)  
- 1–3 examples  
- Link to the owning feature handbook when relevant  

Global flags and exit codes live only in `cli/overview.md` (reference points there).

---

## 7. Maintenance rules

1. Change CLI surface → update `cli/reference{,-ZH}.md` + `agent/commands.json` in the **same** change set when possible.  
2. Change panel production capability → update the feature handbook capability matrix.  
3. EN and ZH in the **same** PR/commit slice — do not let pairs drift.  
4. Prefer tables over long prose.  
5. Examples must be valid dry-run paths unless documenting execute-only behaviour.  
6. Do not invent commands; verify against code or `ysk-server <cmd>` usage text.

### Checks

```bash
node scripts/cli-panel-parity.mjs      # code panel↔CLI (should stay sealed)
node scripts/docs-bilingual-check.mjs  # EN/ZH structure
pnpm docs:check                        # bilingual + cli parity
```

---

## 8. Inventory of documentation work

See [docs-inventory.md](./docs-inventory.md) for domain × file × gap tracking (D0–D5 slices).

---

## 9. Explicit non-goals (this programme)

- Rewriting full product Spec from scratch  
- Translating every architecture drain note  
- Changing UI i18n strings (separate programme)  
- Re-implementing CLI (already sealed at C7 unless a real gap is found)

*Last updated: 2026-08-12 — D0.*
