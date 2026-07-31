# YSK Server documentation index

> Language: English | [中文](./INDEX-ZH.md)

**Product:** single-host Linux control plane + hosting panel (`ysk-server`)  
**Not:** multi-tenant reseller SaaS, web terminal, or guaranteed global email inbox delivery.

## Start here

| Doc | Purpose |
|-----|---------|
| [../README.md](../README.md) | Product overview + quick start |
| [getting-started/install.md](./getting-started/install.md) | Install monorepo / package |
| [getting-started/setup.md](./getting-started/setup.md) | First-time setup |
| [getting-started/go-live.md](./getting-started/go-live.md) | Production checklist |
| [getting-started/readiness.md](./getting-started/readiness.md) | Readiness probe |

## Architecture

| Doc | Purpose |
|-----|---------|
| [architecture/overview.md](./architecture/overview.md) | Layers, HTTP/CLI, honesty |
| [architecture/monorepo.md](./architecture/monorepo.md) | Packages & boundaries |
| [architecture/ops-honesty.md](./architecture/ops-honesty.md) | `written` ≠ `applied` |
| [architecture/state-store.md](./architecture/state-store.md) | json / sqlite / postgres |

## CLI (AI-first)

| Doc | Purpose |
|-----|---------|
| [cli/overview.md](./cli/overview.md) | Global flags, exit codes, locale |
| [cli/reference.md](./cli/reference.md) | **All commands** |
| [cli/parity.md](./cli/parity.md) | Panel ≡ CLI matrix |
| [agent/README.md](./agent/README.md) | Agent rules + runbooks |
| [agent/commands.json](./agent/commands.json) | Machine catalog |

## Features

| Doc | Panel / domain |
|-----|----------------|
| [features/projects.md](./features/projects.md) | Sites / deploy / isolation |
| [features/email.md](./features/email.md) | Mail domains & deliverability |
| [features/files-ftp.md](./features/files-ftp.md) | Files, WebDAV, FTPS |
| [features/databases.md](./features/databases.md) | MySQL / Postgres / Redis |
| [features/dns-ssl-nginx.md](./features/dns-ssl-nginx.md) | DNS, SSL, Nginx |
| [features/runtimes.md](./features/runtimes.md) | Node / PHP / … |
| [features/security-auth.md](./features/security-auth.md) | Login, 2FA, API keys, audit |
| [features/defense.md](./features/defense.md) | Firewall, fail2ban, Defense |
| [features/backups-cron.md](./features/backups-cron.md) | Backups & cron |
| [features/logs-metrics.md](./features/logs-metrics.md) | Log center & metrics |
| [features/cdn-agents.md](./features/cdn-agents.md) | CDN & fleet agents |
| [features/users-rbac.md](./features/users-rbac.md) | Users, packages, RBAC |
| [features/system-host.md](./features/system-host.md) | Host, unit, updates |
| [features/ai-tools.md](./features/ai-tools.md) | Tools, ask, playbooks |
| [features/migrate.md](./features/migrate.md) | Host migrate |

## Operations & security

| Doc | Purpose |
|-----|---------|
| [deploy/root-execute.md](./deploy/root-execute.md) | root + `YSK_EXECUTE=1` |
| [deploy/systemd.md](./deploy/systemd.md) | Control-plane unit |
| [deploy/backup.md](./deploy/backup.md) | Backup ops |
| [deploy/real-ops.md](./deploy/real-ops.md) | Real vs degraded |
| [deploy/isolation.md](./deploy/isolation.md) | Project OS isolation |
| [security/overview.md](./security/overview.md) | Security model |
| [security/2fa.md](./security/2fa.md) | Panel & SSH 2FA |
| [security/ssh.md](./security/ssh.md) | SSH identities |
| [api/overview.md](./api/overview.md) | HTTP API map |
| [i18n.md](./i18n.md) | Locales (zh-HK / zh-CN / en) |

## User manual

| Doc | Purpose |
|-----|---------|
| [user-manual/manual.md](./user-manual/manual.md) | Operator handbook (EN) |
| [user-manual/manual-ZH.md](./user-manual/manual-ZH.md) | 操作員手冊 |

## Spec & history

| Doc | Note |
|-----|------|
| [AI-Secure-Linux-Server-Manager-Spec.md](./AI-Secure-Linux-Server-Manager-Spec.md) | Product specification (EN full text) |
| [AI-Secure-Linux-Server-Manager-Spec-ZH.md](./AI-Secure-Linux-Server-Manager-Spec-ZH.md) | Spec summary (Chinese) |
| [_archive/](./_archive/) | Older gap lists, phase notes, code reviews |

## Conventions

- Every formal doc has a **`-ZH.md`** sibling (Chinese).
- Prefer **CLI + `--json`** for AI agents.
- Host mutations default **dry-run** until `--execute` and `YSK_EXECUTE=1` (often root).
