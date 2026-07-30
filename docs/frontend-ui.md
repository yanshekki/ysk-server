# YSK Server Frontend UI System

Professional control-plane UI patterns for `apps/web`.  
**Source of truth for styling:** `apps/web/src/styles/` only (no page-level CSS / inline styles).

## Goals

- **Feature IA**: one major feature = one independent page + menu entry.
- Dashboard = **feature icon grid** launcher (plus health summary).
- Operators can **scan status** in under 3 seconds on list pages.
- Detail pages use **grouped actions** (tabs / sections), not button soup.
- Shared **UI kit** first; feature pages only compose.
- **Full-width** shell content (no 1200px article column).
- **No JSON as primary UI** — structured facts / notes; technical JSON only behind toggle.
- **Runtime-aware** Projects UI (node / php / static).
- **Honest status** (`active_pending_os` → human label + next step, never raw codes).

## Feature routes (control panel)

| Path | Feature |
|------|---------|
| `/` | Dashboard + feature tiles |
| `/projects`, `/projects/:id` | Sites / projects（總覽含 Nginx/SSL/DNS 交叉連結） |
| `/email` | Email domain list |
| `/email/domains/:id` | Email domain detail（DNS / mailbox / health / relay） |
| `/files`, `/files/public` | File manager / public files nginx |
| `/ftp` | FTPS |
| `/dns`, `/ssl`, `/nginx` | DNS / SSL / reverse proxy |
| `/runtimes/node`, `/runtimes/php` | Runtimes |
| `/databases/*` | MySQL / Postgres / Redis |
| `/security`, `/firewall`, `/fail2ban` | Security |
| `/services`, `/metrics`, `/cron`, `/backups` | Services / stats / cron / backups |
| `/system`, `/system/*`, `/updates` | System tools |
| `/ai`, `/agents` | AI |

Registry: `shared/nav/features.ts` (sidebar sections + dashboard tiles).

## Architecture (FSD-lite)

| Layer | Path | Role |
|-------|------|------|
| Shared UI | `shared/components/ui/` | PageHeader, Modal, Tabs, Badge, OpsResultPanel… |
| Styles | `styles/tokens.css` + `components.css` | Brand tokens + reusable patterns |
| Feature UI | `features/<name>/ui/` | Domain components (e.g. ProjectList) |
| Feature model | `features/<name>/model/` | Status derivation, ops helpers |
| Pages | `pages/*` | Thin assembly + routing |

## Shared components

Import from `shared/components/ui` **only** (no page-level parallel kits):

- **FeaturePageLayout** + **PageTabs** — page chrome  
- **ActionBar** — all button groups (no `btn-row`, no raw flex action rows)  
- **Button** — no raw `className="btn …"` on feature pages  
- **DataTable** — **only** table primitive (no raw `<table>`; ResourceTable must wrap DataTable)  
- **Card / CardSection** — content blocks  
- **Badge** — tones: `ok` | `warn` | `danger` | `neutral` | `info`  
- **Alert** — error / ok / info banners  
- **EmptyState** — empty list + CTA  
- **Modal / ConfirmDialog** — create flows & destructive confirms (prefer over `window.confirm`)  
- **Field / FormLayout / FormActions / PresetChips / SegRadio** — forms  
- **OpsResultPanel** — ops results; props align **`OpsResultDto`** from `@ysk/shared`  
- **SummaryStrip** / **DescriptionList** / **StructuredFacts** — scan-friendly facts  
- **LoadingBlock** — spinner row  

### CSS freeze

- **Do not add** new feature prefixes (`.met-*`, `.def-*`, `.fm-*`, …) when a shared class exists.  
- Prefer tokens in `styles/tokens.css` + patterns in `components.css`.  
- **DataTable only** for tabular data — including live/process grids (`className="data-table--live"` for dense sticky tables).  
- Allowed residual feature classes: domain chrome only (e.g. `.met-live-bar`, `.met-icon-btn`, top header meters) — **not** parallel table systems.  

### CI hard gates (UI)

From repo root (also in GitHub Actions):

```bash
pnpm gates   # honesty:lint + primitives:check + chrome:check
```

| Script | Path | Fails on |
|--------|------|----------|
| `primitives:check` | `apps/web/scripts/page-primitives-check.mjs` | raw `<table>`, `btn-row`, create in FeaturePageLayout.actions |
| `chrome:check` | `apps/web/scripts/page-chrome-check.mjs` | OpsHero / `*-hero` markup; missing FeaturePageLayout |
| `css:reuse` | `apps/web/scripts/css-reuse-check.mjs` | **local / soft** — not CI-hard yet (dynamic `style={{ width }}` meters remain) |

### Related navigation

- One **RelatedNav** / short ActionBar of deep-links (≤3) — no repeated “去 fail2ban / 防火牆 / 防護” button soup on every card.

## Page templates

### List page

```
PageHeader [+ Create]
SummaryStrip (optional)
Toolbar (search / filters / refresh)
List panel (rows → navigate or select)
Create Modal
```

### Detail page

```
Detail header (back · title · StatusBadge · primary actions)
Status rail (4 signals)
Tabs (Overview | Deploy | Network | …)
OpsResultPanel
ConfirmDialog for Stop / Delete
```

## Projects status model

`features/projects/model/status.ts` → `deriveProjectStatus(project)`:

1. failed / unhealthy → danger  
2. `running_degraded` → warn + hint  
3. running → ok  
4. stopped / ready → neutral  

Use **one** primary badge; put secondary signals on the status rail.

## Rollout status

| Page | Pattern applied |
|------|-----------------|
| Projects list + detail | Full (list, modal, tabs, confirms, ops panel) |
| Email | List + modal + tabs + OpsResultPanel |
| Dashboard | PageHeader + SummaryStrip + cards |
| System | Shared params + Tabs (Web/SSL/DNS/Email/安全/資料庫/控制面) + OpsResultPanel |
| Security | PageHeader + SummaryStrip + list approvals + allowlist table |
| Files | PageHeader + list rows + editor section |
| Updates | PageHeader + SummaryStrip + inventory table |
| Agents | PageHeader + SummaryStrip + runtime cards + fleet table |
| AI | PageHeader + SummaryStrip + task list + plan detail |
| Login | Alert component |

## Do / Don't

- **Do** put new visual rules in `styles/components.css` with tokens.  
- **Do** keep destructive actions behind `ConfirmDialog`.  
- **Don't** dump raw JSON as the primary result UI.  
- **Don't** put 10+ equal-weight buttons in one row.  
- **Don't** introduce a second CSS framework (MUI/shadcn) without a design reset.
