# Code Review Wave 2 — close-out

**Status:** **CLOSED** (R0–R7) · 2026-07-30  
**Prior stack:** [code-review-2026-07-30.md](./code-review-2026-07-30.md) (PR1–PR6 ops honesty + UI kit gates)

## Summary

Wave 2 enforced **professional architecture**, **honest ops**, **single product entry**, and **unified types / UI / CSS** across the monorepo. Incomplete capabilities must be **blocked or product-closed**, never fake-success.

| Iron rule | Enforcement |
|-----------|-------------|
| H1 No `ok && blocked` / false `applied` | `assertHonestOps` + `honesty:lint` + unit tests |
| H2 Real data only | Product review + e2e:real-ops; fleet notes honest |
| H3 Single entry | [feature-single-entry.md](./feature-single-entry.md); defense nested routes |
| H4 DTOs in `@yanshekki/shared` only | Domain modules; web re-exports |
| H5 UI kit only | `primitives:check` + `chrome:check` + `about-tab:check` |
| H6 No fluff dual CTAs | R3 nav/link cleanup |
| H7 No parallel CSS | `styles/components/*` + `css:reuse` in gates |

## Delivered stack

| ID | Name | Outcome |
|----|------|---------|
| **R0** | Inventory | `review:inventory`, feature map, about-tab gate, CDN/DNS `sendOpsResult` |
| **R1** | Shared DTO domainization | Domain DTO files in `@yanshekki/shared`; web/core wired |
| **R2** | HTTP routes split | Thin `http-server` + `routes/*` modules |
| **R3** | Single-entry defense | `/protection/*` tools; legacy redirect; delete `DbServicePage` |
| **R4** | CDN fleet honesty | Enqueue + agent `cdn.edge.*`; UI field; never fake applied |
| **R5** | Dead UI removal | ExecutionResultPanel, KeyValueList, ResourceTable, CapabilityBanner, SettingField gone |
| **R6** | CSS modules + reuse gate | `styles/components/*.css`; `css:reuse` hard in `pnpm gates` |
| **R7** | Close-out | This doc + [CHANGELOG](../../CHANGELOG.md) Wave 2 section |

## CI gates (authoritative)

```bash
pnpm gates
# honesty:lint → primitives:check → chrome:check → about-tab:check → css:reuse

pnpm typecheck
pnpm test
# optional: pnpm e2e:real-ops
pnpm review:inventory   # read-only debt report
```

| Gate | Script | Enforces |
|------|--------|----------|
| honesty | `apps/server/scripts/honesty-lint.mjs` | No dishonest `sendJson(ok?200:422)`; no `ok:true`+`blocked:true` patterns |
| primitives | `apps/web/scripts/page-primitives-check.mjs` | DataTable / Form / ActionBar; no raw table / btn-row |
| chrome | `apps/web/scripts/page-chrome-check.mjs` | FeaturePageLayout + status; no OpsHero |
| about-tab | `apps/web/scripts/about-tab-check.mjs` | PageGuide ⇒ trailing「說明」tab |
| css:reuse | `apps/web/scripts/css-reuse-check.mjs` | No disallowed inline styles; core class patterns present |

## Findings board (close state)

### Closed

| ID | Topic | Resolution |
|----|--------|------------|
| W2-01 | God-file HTTP | `routes/*` + ~120 LOC dispatcher |
| W2-03 | Dual defense UIs | Nested under `/protection`; redirects |
| W2-04 | DTO sprawl | `@yanshekki/shared` domain modules |
| W2-05 | CDN fleet stub | Real enqueue + agent apply; honest statuses |
| W2-06 | DbServicePage | Deleted |
| W2-07 | Dead UI exports | Deleted + CSS cleanup |
| W2-09 | CSS monolith / soft reuse | Modules + hard gate |
| W2-11 | frontend-ui peer routes | Docs + nav aligned |
| W2-12–13 | About tab missing / regression | Tabs fixed + gate |
| W2-16 | CDN/DNS sendJson ternary | `sendOpsResult` |

### Explicitly deferred (not Wave 2 blockers)

| ID | Topic | Owner / next |
|----|--------|----------------|
| W2-02 | `system-controller.ts` ~2.2k | Future route/controller slice |
| W2-08 | God pages (Protection, Logs, Cdn, …) | Feature `ui/` extraction |
| W2-10 | Empty scaffold dirs | **fixed (R7)** — removed empty `web/shared/{types,interfaces,constants}`, `core/{middlewares,utils}` |
| W2-14 | Adminer/webmail placeholder without EXECUTE | Keep honest `blocked` |
| W2-15 | DescriptionList vs InfoCard | Prefer DescriptionList for facts; InfoCard for entity status |

## Canonical references

| Concern | Doc / path |
|---------|------------|
| Layers & gates | [overview.md](./overview.md) |
| Single entry IA | [feature-single-entry.md](./feature-single-entry.md) |
| Frontend kit & CSS | [../frontend-ui.md](../frontend-ui.md) |
| Wave 1 honesty stack | [code-review-2026-07-30.md](./code-review-2026-07-30.md) |
| Product changelog | [../../CHANGELOG.md](../../CHANGELOG.md) |

## UI kit (canonical after R5)

| Use | Component |
|-----|-----------|
| Page shell | `FeaturePageLayout` + `PageTabs` / `WithPageGuide` |
| Tables | `DataTable` |
| Ops result | `OpsResultPanel` (`OpsResultDto`) |
| Facts | `DescriptionList` / `SummaryStrip` / `StructuredFacts` |
| Forms | `Field` / `FormLayout` / `FormActions` / `SegRadio` / `PresetChips` |
| Confirm / prompt | `ConfirmDialog` / `PromptDialog` |
| Buttons | `Button` / `buttonClassName` |
| Docs tab | last tab「說明」+ `PageGuide` catalog |

## CSS layout (after R6)

```
apps/web/src/styles/
  index.css              # single entry
  tokens.css
  base.css
  utilities.css
  components/
    index.css            # barrel imports
    buttons.css, form.css, table.css, …
    defense.css, metrics.css, …
  components.css         # shim → components/index.css
```

**Inline `style={{`:** only CSS custom properties (e.g. `--meter-pct`). Spacing/layout → utilities.

## Acceptance checklist (Wave 2)

- [x] Architecture overview matches repo (DTO + HTTP layout + gates)
- [x] `pnpm gates` includes honesty, primitives, chrome, about-tab, **css:reuse**
- [x] feature-single-entry: defense is single primary; tools nested
- [x] CDN fleet incomplete path is productized (queue + agent), never fake applied
- [x] Dead UI kit members removed; canonical kit documented
- [x] CSS modularized; disallowed inline styles = 0 under reuse gate
- [x] CHANGELOG Wave 2 section written
- [x] Deferred findings listed with next-step owner class

## Follow-ups (optional next waves)

1. Slice `system-controller` + drain `routes/misc.ts` into domain modules  
2. Break god pages into `features/*/ui/*`  
3. Raise `css:reuse` top15 share aspirational target (informational only)  
4. Expand e2e:real-ops for CDN fleet queue → agent ack path  

---

*Closed by R7. Do not reopen this board for new work — open a new wave doc.*
