# Changelog

## 0.1.0

### Phase 1 – Architecture scaffold + MVP
- TypeScript monorepo (`@ysk/shared`, `@ysk/core`, `@ysk/server`, `@ysk/web`)
- Web UI auth + zh-TW / en / zh-CN i18n
- Outbound Agent communication path
- Hard Allowlist (fail-closed) + Human Approval queue
- OpenAI-compatible LLM gateway (always untrusted)
- CLI: `ysk-server setup|update|serve|tools|agents`
- `install.sh` bootstrap for Ubuntu 22.04/24.04

### Phase 2 – Hosting core + security
- Project isolation (independent Linux user/group plans)
- Multi-version Node.js + PHP hosting contracts
- MySQL/MariaDB + Redis management plans
- Nginx reverse proxy + Let’s Encrypt plans
- Full three-axis RBAC
- Kernel Sandbox planner
- Offline / Protection Mode

### Phase 3 – Full platform
- Public File Server, FTPS, DNS, Firewall/fail2ban, cron, logs, backup, monitoring
- Intelligent software update & vulnerability advice + self-update (migrate/verify/rollback/audit)
- AI agent runtime management (OpenClaw / Hermes / IonClaw)
- Professional Email Server guided deploy + external checklist (MX/SPF/DKIM/DMARC/PTR/Port 25) + health score
- Architecture, API, CLI, security, deploy, email, AI agent, and multi-language user docs
