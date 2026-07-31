# AI Secure Linux Server Manager — Full Requirements & Design Spec

> Language: English | [中文](./AI-Secure-Linux-Server-Manager-Spec-ZH.md)

**Version**: 0.9 (Draft)  
**Date**: 2026-07-23  
**Status**: Requirements gathered; ready for professional architecture implementation  
**Goal**: Single authoritative specification for the Grok Build / engineering team

---

## 0. Official naming (confirmed)

| Item | Name |
|------|------|
| **Product name** | YSK Server |
| **CLI command** | `ysk-server` |
| **GitHub repository** | https://github.com/yanshekki/ysk-server |
| **npm package page** | https://www.npmjs.com/package/ysk-server |
| **npm package name** | `ysk-server` |
| **One-line install script** | `curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh \| bash` |
| **Setup command** | `ysk-server setup` |
| **Update command** | `ysk-server update` |

All documentation, code, CLI help, and page titles must use the naming above.

## 1. Vision and goals

### 1.1 Vision

Build an **AI-centric, security-first** Linux server management platform that also delivers a **full web hosting control panel**.

Core support:
- Natural-language operations with multi-layer hard safety constraints
- Local private LLMs + any OpenAI-compatible API
- Remote fleet management
- Manage mainstream AI agent runtimes (OpenClaw, Hermes, IonClaw, …)
- Keep protecting and operating under network partition / DDoS where possible
- Full web admin UI + AI-agent-friendly CLI
- Multi-language support (Traditional Chinese first)
- **Full web hosting** (Node.js / PHP / Database / Files / SSL / DNS / Firewall / Proxy, …)
- **Intelligent software update & vulnerability management** (daily LLM analysis + auto/confirm updates)
- **Professional email server one-click setup** (anti-spam + external setup guidance)

### 1.2 Core principles

1. **LLM is fully untrusted** (Untrusted LLM)
2. **Security over convenience** (Defense-in-Depth)
3. **Local-First + Graceful Degradation**
4. **Human final authority** (Human-in-the-loop for high-risk actions)
5. **Auditable, reversible, RBAC-capable**
6. **Project-level isolation** (each site/app runs as its own Linux user)
7. **Professionally maintainable architecture** (modular, testable, extensible)

---

## 2. Tech stack & architecture requirements (mandatory)

### 2.1 Mandatory tech stack

- **Backend / control plane / CLI / Agent**: Node.js + TypeScript
- **Frontend web UI**: React.js + TypeScript
- **Full-stack TypeScript**; no other primary languages unless approved
- Package manager: pnpm or npm (pnpm preferred)
- Build: tsup / unbuild / esbuild (modern tooling)
- Tests: Vitest or Jest (TypeScript required)
- Docs: Typedoc + project Markdown

### 2.2 Layered architecture (strict)

The project must stay highly modular. Suggested layout (can be refined):

```
src/
├── interfaces/          # Interface definitions
├── types/               # Shared types, enums, utilities
├── dto/                 # Data Transfer Objects
├── entities/            # Domain entities
├── repositories/        # Data access
├── services/            # Business logic
├── controllers/         # HTTP / API controllers
├── cli/                 # CLI commands
├── agents/              # Remote agent logic
├── skills/              # AI skill definitions and execution
├── security/            # Permissions, allowlist, sandbox, RBAC
├── hosting/             # Web hosting modules
├── llm/                 # LLM gateway, providers, tool calling
├── update/              # Smart update & vulnerability analysis
├── errors/              # Unified errors
├── utils/               # Pure helpers
├── config/              # Config load/validate
├── middlewares/         # HTTP middlewares
└── tests/               # or colocated *.test.ts
```

**Additional mandatory rules**:
- Single clear responsibility per folder
- Dependency direction Controller → Service → Repository
- No circular dependencies
- Heavy use of interfaces and dependency injection
- Unified error handling (custom Error classes + codes)
- Public functions require full JSDoc / TSDoc

### 2.3 One-click install and update

#### A. Final install path (Node.js already present)

- Support global install via `npm install -g @ysk/server` (or final package name)
- After install, `ysk-server setup` initializes the control plane and required deps

#### B. Fresh Ubuntu Server bootstrap (no Node.js)

- **Must ship official `install.sh`**, e.g.:
  ```bash
  curl -fsSL https://get.ysk.hk/server-manager | bash
  ```
  or
  ```bash
  curl -fsSL https://raw.githubusercontent.com/.../install.sh | bash
  ```
- `install.sh` must:
  - Detect OS (perfect support for Ubuntu 22.04 / 24.04)
  - Install Node.js LTS reliably (NodeSource / fnm / nvm, …)
  - Install system deps (build-essential, curl, git, …)
  - Install this product globally
  - Optionally run `ysk-server setup`
  - Clear progress + error handling
  - Non-interactive mode for scripted deploy
  - Print next steps and doc links
- Script safety: `set -euo pipefail`, verify downloads (checksum/signature preferred), avoid dangerous ops

#### C. Self-update

- **Must provide one-command self-update** (`ysk-server update`)
  - Check latest version
  - Download, verify, replace binary/files
  - Run DB migrations
  - Rollback path
  - Full logs and audit
- Update may also be triggered via `install.sh` upgrade mode

### 2.5 Frontend architecture (as strict as backend)

Frontend (`apps/web`) must be modular and maintainable—not a flat React dump.

#### Recommended layout (Feature-Sliced + Layered)

```text
apps/web/src/
├── app/                       # Entry, providers, router, global styles
│   ├── providers/
│   ├── router/
│   └── styles/
├── pages/                     # Route pages (thin composition)
├── features/                  # Business features (core)
│   ├── auth/
│   ├── servers/
│   ├── projects/
│   ├── hosting/
│   ├── email/
│   ├── agents/
│   ├── security/
│   ├── updates/
│   ├── llm/
│   └── dashboard/
├── entities/                  # Optional domain entities
├── shared/                    # Cross-feature shared
│   ├── components/
│   ├── hooks/
│   ├── services/
│   ├── types/
│   ├── interfaces/
│   ├── utils/
│   ├── constants/
│   ├── lib/
│   ├── stores/
│   └── errors/
└── widgets/                   # Optional composite widgets
```

#### Frontend layering (mandatory)

| Layer | Responsibility | Notes |
|-------|----------------|-------|
| **pages/** | Route entry | Compose features only; almost no logic |
| **features/** | Business features | Isolated components, hooks, API calls |
| **shared/services/** | API layer | All backend calls; align DTOs |
| **shared/types & interfaces/** | Types | Align with backend shared package |
| **shared/components/** | Pure UI | No business logic |
| **shared/hooks/** | Reusable logic | Fetch, authz, forms |
| **shared/stores/** | Client state | User, theme, permissions |

#### Additional mandatory frontend rules

- All API calls go through `shared/services` (no fetch/axios in random components)
- Strict TypeScript; sync DTOs via `packages/shared`
- Unified error handling (API, authz, network)
- i18n (react-i18next or equivalent)
- Testable components; unit tests for important logic
- Frontend permission gates (backend remains source of truth)
- Clear Loading / Empty / Error states

#### State management suggestions

- Server state: TanStack Query
- Client global state: Zustand or Jotai
- Forms: React Hook Form + Zod

### 2.4 Testing requirements (mandatory)

- **Every function/file should have unit tests**
- Coverage targets: core business logic ≥ 90%, overall ≥ 80%
- Vitest or Jest
- Integration tests for critical flows
- CI must run full tests; failures block merge

---

## 3. Feature requirements overview

### 3.1 Core AI management

- Natural-language tasks
- Multi-step planning (Plan → Review → Execute)
- Tool calling for real commands
- Root-cause analysis (RCA)
- Common-issue auto-remediation playbooks
- Generate Ansible / scripts / config advice
- Predictive monitoring and anomaly detection

### 3.2 Security management and constraints

Multi-layer hard limits (code allowlist + default read-only + human approval + kernel sandbox, …)

### 3.3 RBAC

3D model: user role + resource scope (server / project) + operation level (Read / Write-Low / Write-High / Destructive / Privilege)

### 3.4 Remote management and fleet

Outbound agent, one-click install, groups, bulk ops, live status

### 3.5 AI agent runtime management

Remote install/configure/monitor for OpenClaw, Hermes, IonClaw, …

### 3.6 LLM integration

Full OpenAI-compatible API support (LiteLLM or custom gateway)

### 3.7 Network partition / DDoS resilience

Protection mode + local LLM + emergency playbooks

### 3.8 CLI (AI-agent friendly)

Structured output, schema discovery, dry-run, full permission control

### 3.9 Web admin UI

Modern dashboard + hosting + approval queue + multi-language

### 3.10 Multi-language

Web UI and docs: Traditional Chinese (priority), English, Simplified Chinese

---

## 4. Full web hosting requirements

### 4.1 Project / site management

- Each project runs as an **independent Linux user/group**
- Domain binding, resource limits, staging/production, Git deploy

### 4.2 Node.js hosting

- Multi Node versions per project
- PM2 / systemd management
- Env vars, auto-restart, optional serverless-style paths

### 4.3 PHP hosting

- Apache path where needed
- Multi PHP versions per project
- Independent pool / vhost, php.ini overrides

### 4.4 Databases

- MySQL/MariaDB multi-database + multi-user + fine grants
- Redis multi-instance / multi-DB

### 4.5 Files and public file server

- Per-project dirs + public file server (API for projects)
- FTPS, web file manager, quotas

### 4.6 SSL

- Let’s Encrypt issue/renew
- User-uploaded certs
- Cloudflare-compatible paths

### 4.7 Nginx reverse proxy

- Proxy to projects/services
- Cloudflare real-IP / proxy mode support

### 4.8 DNS server

- Built-in or strong integration (PowerDNS / Cloudflare API)

### 4.9 Firewall management

- System + project rules, fail2ban integration

### 4.10 Other

- Cron, logs, backup, resource monitoring, env vars, one-click apps, …

---

## 5. Professional email server quick setup

The system must provide **one-click / guided professional email server** setup and embed deliverability knowledge and checks.

### 5.1 Core goals

- Deploy a usable professional mail stack (send/receive)
- Maximize deliverability effort
- **Clearly tell operators what must be done outside the server**
- Automated checks and fix guidance

### 5.2 Suggested stack (configurable)

- **MTA**: Postfix
- **IMAP/POP3**: Dovecot
- **Anti-spam**: Rspamd (preferred) or SpamAssassin
- **DKIM**: OpenDKIM
- **DMARC reports**: OpenDMARC or equivalent
- **Webmail** (optional): SnappyMail or Roundcube
- **Certs**: Let’s Encrypt for SMTP/IMAP
- Storage: system home dirs or dedicated vmail user

### 5.3 What the system can automate

- Install and harden Postfix + Dovecot basics
- Create mail users (system or virtual)
- Generate DKIM key pairs
- Configure OpenDKIM / DMARC
- Correct myhostname, myorigin, TLS
- Basic rate/connection limits
- Open required firewall ports (25, 587, 465, 993, 995, … configurable)
- Produce full DNS record suggestions
- Periodic local queue/log checks
- Test-send helpers

### 5.4 External work the operator must do (critical)

The UI must list and check these prominently during setup and on the dashboard.

#### A. DNS records (at the DNS provider)

Auto-generated records with one-click copy:

| Type | Name/host | Content | Importance |
|------|-----------|---------|------------|
| MX | @ | Points to mail hostname | Required |
| TXT (SPF) | @ | `v=spf1 mx a ip4:SERVER_IP ~all` or stricter | Required |
| TXT (DKIM) | `default._domainkey` | Public key from system | Required |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none/quarantine/reject; rua=mailto:…` | Strongly recommended |
| A/AAAA | mail (or chosen host) | Server IP | Required |

Optional but recommended: BIMI, MTA-STS, TLS-RPT.

**Note:** On Cloudflare, MX-related records usually need **DNS only** (grey cloud).

#### B. Reverse DNS (PTR) — often forgotten, critical

- PTR is set by the **IP owner** (VPS/cloud)
- PTR should match Postfix HELO/EHLO
- System must detect PTR and tell the operator to set it in the VPS console
- Many providers block or require tickets for PTR

#### C. Outbound Port 25

- Many clouds block outbound TCP 25 by default
- Detect external port 25 reachability
- If blocked, instruct operator to request unblock **or** configure SMTP relay

#### D. IP and domain reputation

- New IP/domain should not blast volume immediately
- Monitor blacklists (Spamhaus, Barracuda, …)
- Periodic blacklist checks in panel
- Warm-up strategy tips

#### E. Other external notes

- Avoid abused IP ranges
- Young domains carry risk
- Align From / Return-Path
- Avoid “cheap mail server” IPs

### 5.5 Checks and guidance features

- **DNS health check**: SPF/DKIM/DMARC/MX/PTR pass/fail + fix hints
- **One-click DNS record generation** (copyable)
- **Test send** + spam-folder guidance
- **Blacklist checks**
- **Setup score** (e.g. 70/100 missing PTR/DMARC)
- Clear **external todo list** for registrar + VPS work

### 5.6 Integration with the rest of the system

- Email setup under RBAC + approval
- Mail ops in audit log
- Optional inclusion in daily smart update checks
- Multi-domain, multi-mailbox
- Optional integration with projects/users

### 5.7 Documentation requirements

Dedicated clear docs (Traditional Chinese detail allowed) covering:
- Why external settings matter
- Steps on common providers (Cloudflare, Namecheap, Aliyun, Route53, VPS consoles)
- FAQ (spam folder, rejects, Port 25, …)

---

## 6. Intelligent software updates & vulnerability management

### 6.1 Daily automatic inventory

- Daily scheduled inventory of installed software on managed servers
- Collect current version info

### 6.2 LLM analysis of whether to update

- Analyze changelogs, security fixes, breaking changes, compatibility risk
- Structured advice: update / wait / emergency update

### 6.3 Public vulnerability sources

- Query NVD, GitHub Advisories, distro security notices, CVE DBs
- LLM severity judgment vs installed versions
- Records and reports

### 6.4 Update execution strategy

- **Auto-update**: low risk, clear security fix, tested
- **Human confirm**: medium/high risk → approval queue
- Full audit trail (before/after version, result, rollback info)
- One-click rollback

### 6.5 Security system integration

- Updates still pass allowlist, RBAC, approval
- Critical vulns may raise notification priority / protection mode advice

---

## 7. Tech stack summary table

| Layer | Technology | Notes |
|-------|------------|-------|
| Frontend | React.js + TypeScript | Mandatory |
| Backend / CLI / Agent | Node.js + TypeScript | Mandatory |
| Tests | Vitest or Jest | Unit tests per function/file target |
| LLM gateway | LiteLLM or custom OpenAI-compatible layer | |
| Database | PostgreSQL + Redis | Spec-level target |
| Web server | Nginx + Apache | For hosting |
| Package publish | npm global package | `npm install -g` + setup/update |
| Docs | Docusaurus + Typedoc | Multi-language |

---

## 8. Suggested development phases

### Phase 1 – Architecture skeleton + MVP

- Full TypeScript structure (interfaces, dto, services, controllers, errors, cli, …)
- Unit test harness + coverage enforcement
- Basic React UI + auth
- Remote agent comms
- Hard allowlist + approval flow
- OpenAI-compatible LLM support
- Basic CLI
- One-click setup skeleton
- Traditional Chinese + English

### Phase 2 – Hosting core + security hardening

- Project isolation (dedicated Linux users)
- Multi Node + multi PHP
- MySQL + Redis
- Nginx proxy + Let’s Encrypt
- Kernel sandbox, full RBAC
- Offline / protection mode

### Phase 3 – Full hosting + smart updates + agent ecosystem

- Public file server + FTPS + DNS + firewall
- Smart update & vuln analysis (daily LLM)
- OpenClaw / Hermes / IonClaw management
- Full one-click self-update
- High test coverage and documentation

---

## 9. Documentation & deliverables

- This specification (continuously updated)
- Full API documentation
- CLI reference (multi-language)
- Architecture docs (per-layer duties)
- User manuals (multi-language)
- Security architecture notes
- Deploy + one-click install/update guides
- AI agent usage guide
- Test reports and coverage

---

## 10. Next actions

1. Confirm this spec (especially stack, layering, tests, smart updates)
2. Design detailed data model and DB schema
3. Design core API and CLI command list
4. Scaffold the project (layers + tests)
5. Implement one-click setup and self-update
6. Start Phase 1 development

---

**This document is the development authority. Material changes require updating this file and recording the version.**

*Version 0.4 — Mandatory Node.js + React + TypeScript architecture, full unit-test expectations, npm global one-click install/update, and intelligent software update & vulnerability management.*
