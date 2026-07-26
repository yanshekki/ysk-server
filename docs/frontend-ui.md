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

Import from `shared/components/ui`:

- **PageHeader** — title, subtitle, action slot  
- **Card / CardSection** — content blocks  
- **Badge** — tones: `ok` | `warn` | `danger` | `neutral` | `info`  
- **Alert** — error / ok / info banners  
- **EmptyState** — empty list + CTA  
- **Modal / ConfirmDialog** — create flows & destructive confirms  
- **Tabs** — detail sections  
- **Field / FormGrid** — forms  
- **KeyValueList** — overview meta  
- **CodeBlock / LogViewer** — technical output  
- **OpsResultPanel** — human notes first, JSON collapsible  
- **SummaryStrip** — count pills  
- **LoadingBlock** — spinner row  

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
