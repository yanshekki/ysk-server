# YSK Server

**YSK Server** (`ysk-server`) is an AI-centric, security-first Linux server management platform with a full web hosting control panel.

- **CLI**: `ysk-server`
- **npm package**: `ysk-server`
- **Repository**: https://github.com/yanshekki/ysk-server

## Features

- Untrusted LLM gateway (OpenAI-compatible) with hard Allowlist + Human Approval
- Three-axis RBAC (role × resource scope × operation level)
- Project isolation via independent Linux users
- Multi-version Node.js / PHP hosting, MySQL, Redis, Nginx, Let’s Encrypt
- Intelligent updates & vulnerability advice with rollback
- Professional Email Server guided deploy (Postfix/Dovecot/DKIM) + external checklist (DNS/SPF/DKIM/DMARC/PTR/Port 25)
- AI agent runtime management (OpenClaw / Hermes / IonClaw)
- Offline / DDoS Protection Mode
- Web UI + AI-agent-friendly CLI (structured JSON, dry-run, schema discovery)

## Quick install (Ubuntu 22.04 / 24.04)

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash
```

Non-interactive:

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive
```

From source:

```bash
./install.sh --from-source --non-interactive
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @ysk/server exec node dist/cli.js --help
pnpm --filter @ysk/server exec node dist/cli.js serve
pnpm --filter @ysk/web dev
```

## CLI

```bash
ysk-server setup --non-interactive
ysk-server serve
ysk-server update --check
ysk-server tools --json
ysk-server --help
```

## Documentation

| Doc | Path |
|-----|------|
| Architecture | [docs/architecture/overview.md](docs/architecture/overview.md) |
| API | [docs/api/overview.md](docs/api/overview.md) |
| CLI Reference | [docs/cli/reference.md](docs/cli/reference.md) |
| Security | [docs/security/overview.md](docs/security/overview.md) |
| Deploy / Install / Update | [docs/deploy/install-update.md](docs/deploy/install-update.md) |
| Email external setup | [docs/email/external-setup.md](docs/email/external-setup.md) |
| AI Agent guide | [docs/ai-agent/guide.md](docs/ai-agent/guide.md) |
| User manual (zh-TW) | [docs/user-manual/zh-TW.md](docs/user-manual/zh-TW.md) |
| Spec | [docs/AI-Secure-Linux-Server-Manager-Spec.md](docs/AI-Secure-Linux-Server-Manager-Spec.md) |

## License

MIT
