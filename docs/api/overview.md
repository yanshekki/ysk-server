# YSK Server API Overview

Base URL: `http://127.0.0.1:8787`

## Core

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health + protection mode |
| GET | `/api/v1/status` | No | Product, tools, execute flag |
| POST | `/api/v1/auth/login` | No | Login |
| POST | `/api/v1/auth/logout` | Bearer | Logout |
| GET | `/api/v1/auth/me` | Bearer | Current user |
| GET | `/api/v1/users` | Admin | List users |
| GET | `/api/v1/audit` | Bearer | Audit log |
| GET | `/api/v1/metrics` | Bearer | Host metrics + alerts |

## Tools / security

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/tools` | Bearer | Allowlist catalog |
| POST | `/api/v1/tools/execute` | Bearer | Allowlist+RBAC+Approval tool run |
| GET | `/api/v1/approvals` | Bearer | Approval queue |
| POST | `/api/v1/approvals/:id/approve` | Bearer | Approve |
| POST | `/api/v1/protection` | Bearer | Set protection mode |

## AI (Plan → Review → Execute)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/ai/tasks` | Bearer | List AI tasks |
| POST | `/api/v1/ai/tasks` | Bearer | Create plan from natural language |
| POST | `/api/v1/ai/tasks/:id/approve` | Bearer | Approve steps |
| POST | `/api/v1/ai/tasks/:id/execute` | Bearer | Execute via tool gate |
| GET | `/api/v1/ai/playbooks` | Bearer | Built-in playbooks |
| POST | `/api/v1/ai/playbooks/run` | Bearer | Run playbook |
| POST | `/api/v1/ai/rca` | Bearer | Root-cause report from host facts |

## Projects / hosting

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/api/v1/projects` | Bearer | List / create |
| POST | `/api/v1/projects/:id/node-apply` | Bearer | Write Node unit+env under dataDir |
| GET | `/api/v1/hosting/nginx` | Bearer | Managed nginx confs |
| POST | `/api/v1/hosting/nginx/sync` | Bearer | Sync nginx |
| POST | `/api/v1/hosting/db/probe` | Bearer | TCP probe MySQL/Redis |
| POST | `/api/v1/hosting/db/mysql-plan` | Bearer | SQL provision plan |
| POST | `/api/v1/hosting/dns/plan` | Bearer | DNS zone plan |
| POST | `/api/v1/hosting/firewall/plan` | Bearer | Firewall plan |
| GET | `/api/v1/hosting/files/plan` | Bearer | Public file server plan |

## Email

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/api/v1/email/domains` | Bearer | Domains + DKIM |
| GET | `/api/v1/email/domains/:id/dns` | Bearer | DNS bundle |
| POST | `/api/v1/email/domains/:id/live-check` | Bearer | Live MX/SPF/DKIM/DMARC/PTR/Port25/DNSBL |
| POST | `/api/v1/email/domains/:id/test-send` | Bearer | Test send |

## Updates / Fleet

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/updates/inventory` | Bearer | Package inventory + advice |
| GET | `/api/v1/updates/self` | Bearer | Self-update plan |
| GET/POST | `/api/v1/fleet/agents` | Bearer | Fleet list / register |
| POST | `/api/v1/fleet/agents/:id/heartbeat` | — | Heartbeat |
| GET/POST | `/api/v1/fleet/agents/:id/commands` | Bearer | Pull / enqueue commands |

LLM outputs are always `untrusted: true` and never execute without the tool gate.
