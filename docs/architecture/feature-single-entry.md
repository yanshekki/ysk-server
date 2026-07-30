# Feature single-entry map

**Rule (H3):** one capability = one primary operator entry. Secondary paths either redirect, deep-link into the primary page, or are removed.

**Registry source:** `apps/web/src/shared/nav/features.ts`  
**Routes:** `apps/web/src/app/App.tsx`

| Capability | Primary route | Primary UI | Core module(s) | Secondary (allowed) | Forbidden parallel |
|------------|---------------|------------|----------------|---------------------|-------------------|
| Dashboard | `/` | `DashboardPage` | host-overview, metrics | — | second home dashboard |
| Sites / projects | `/projects`, `/projects/:id` | Projects* | hosting projects, nginx, ssl | overview cross-links | separate nginx-only site CRUD as main IA |
| Email domains | `/email`, `/email/domains/:id` | Email* | `email/*` | — | — |
| Files | `/files` | `FilesPage` | `files/*` | — | — |
| Public files nginx | `/files/public` | `PublicFilesPage` | hosting extras / nginx | — | duplicate public share UI |
| FTP accounts | `/ftp` | `FtpPage` | managed-resources ftp, ftps | link to service | second FTP account grid |
| **vsftpd / FTPS service** | `/ftp/service` | `FtpsServicePage` | `ftps-service` | from FTP page | dual service consoles |
| DNS zones | `/dns` | `DnsPage` | dns-zone, dns-cluster | CDN DNS sync notes | — |
| CDN edges/sites | `/cdn` | `CdnPage` | `hosting/cdn/*` | DNS related | commercial Anycast claims |
| SSL certs | `/ssl` | `SslPage` | nginx-ssl, certs | project SSL | — |
| Nginx sites | `/nginx` | `NginxPage` | nginx-sync | project network | — |
| Node runtime | `/runtimes/node` | `NodeRuntimePage` | node-apply | — | GenericRuntime for node |
| PHP runtime | `/runtimes/php` | `PhpRuntimePage` | php | — | — |
| Other runtimes | `/runtimes/{python,go,rust}` | `GenericRuntimePage` | runtime | — | copy-paste full pages |
| MySQL data | `/databases/mysql` | `MysqlPage` → `SqlEnginePage` | db-engine, mysql-provision | — | Mariadb UI for MySQL |
| MariaDB data | `/databases/mariadb` | `MariadbPage` → `SqlEnginePage` | db-engine | — | — |
| Postgres data | `/databases/postgres` | `PostgresPage` | postgres-provision | — | — |
| Redis data | `/databases/redis` | `RedisPage` | redis | — | — |
| DB **service** (my/maria/pg/redis) | `/databases/*/service` | `*ServicePage` → `ServiceConsolePage` | db-service-config | — | deleted `DbServicePage` |
| **Host defense / DDoS** | **`/protection`** | `ProtectionPage` | defense, firewall-ops, fail2ban-ops | deep-link `?tab=` | peer top-level `/firewall` `/fail2ban` |
| UFW ports (tool) | **`/protection/firewall`** | `FirewallPage` | firewall-ops | legacy `/firewall` → redirect | sidebar entry |
| fail2ban (tool) | **`/protection/fail2ban`** | `Fail2banPage` | fail2ban-ops | legacy `/fail2ban` → redirect (query kept) | sidebar entry |
| Auth / SSH / 2FA | `/security` | `SecurityPage` | security/* | — | — |
| Users / RBAC | `/users` | `UsersPage` | repositories users | — | — |
| Systemd units list | `/services` | `ServicesPage` | services | — | — |
| Metrics / top | `/metrics` | `MetricsPage` | monitoring/* | — | parallel met-table |
| Network | `/network` | `NetworkPage` | net/* | — | — |
| Logs | `/logs` | `LogsPage` | log-center | deep-link ban → protection | — |
| Cron | `/cron` | `CronPage` | backup-cron / host cron | — | — |
| Backups | `/backups` | `BackupsPage` | backup-restic | — | — |
| Host migrate | `/system/migrate` | `MigrateHostPage` | host-migrate | — | — |
| Updates | `/updates` | `UpdatesPage` | update/* | — | — |
| Systemd unit detail | `/system/unit` | `SystemdUnitPage` | services | — | — |
| Readiness | `/system/readiness` | `ReadinessPage` | host health | shortcuts → primary features | — |
| System index | `/system` | `SystemPage` | host-power, overview | — | — |
| AI tasks | `/ai` | `AiPage` | llm/* | — | — |
| Agents fleet | `/agents` | `AgentsPage` | agents/* | — | placeholder unit as “running” |

## UI composition rules

| Pattern | Canonical | Deprecated / do not grow |
|---------|-----------|---------------------------|
| Page shell | `FeaturePageLayout` + `status=` | OpsHero, raw `*-hero` |
| Tabs | `PageTabs` / `WithPageGuide` | ad-hoc tab rows |
| Tables | `DataTable` | raw `<table>` |
| Ops result | `OpsResultPanel` (`OpsResultDto`) | removed `ExecutionResultPanel` (R5) |
| Facts | `DescriptionList` / `SummaryStrip` / `StructuredFacts` | removed `KeyValueList` (R5) |
| Confirm / prompt | `ConfirmDialog` / `PromptDialog` | `window.confirm` / `prompt` |
| Buttons | `Button` / `buttonClassName` | raw `className="btn …"` |
| Empty | `EmptyState` **one primary CTA** | dual create + “前往” peers |
| Docs tab | last tab `說明` + `PageGuide` / catalog | PR progress copy |

## API / DTO ownership

| Surface | Owner package |
|---------|----------------|
| Auth, health, tool, LLM chat | `@ysk/shared` `dto.ts` |
| Ops honesty | `@ysk/shared` `ops.ts` |
| CDN | `@ysk/shared` `cdn.ts` |
| Migrate | `@ysk/shared` `migrate.ts` |
| Domain API shapes | **`@ysk/shared` domain modules** (web `features/*/api.ts` re-exports) |

## Honest incomplete capabilities

| Capability | Status | Product rule |
|------------|--------|--------------|
| CDN fleet-agent dispatch | **R4:** enqueue `cdn.edge.apply/purge`; agent `runCdnFleetPayload`; SSH preferred when both set | UI: fleet session field + hints; status written/blocked never fake applied |
| Adminer / webmail download without EXECUTE | writes honest placeholder file | `blocked` / notes, never pretend downloaded |
| Agent unit without CLI binary | refuses enable silent placeholder | UI must surface probe notes |

## Nav vs routes (R3)

- Sidebar: **only** `/protection` under security for host defense.
- Nested tools: `/protection/firewall`, `/protection/fail2ban` (sidebar highlights 防護中心 via `isNavActive` prefix).
- Legacy `/firewall` / `/fail2ban` → redirect preserve query.
- Dashboard / Services / Readiness: single「防護中心」CTA（無雙 fail2ban+防火牆捷徑）.
