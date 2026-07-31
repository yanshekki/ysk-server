# AI Agent Guide

> Language: English | [中文](./guide-ZH.md)

> **Canonical docs moved to [docs/agent/README.md](../agent/README.md)**  
> CLI reference: [docs/cli/reference.md](../cli/reference.md) · Catalog: [docs/agent/commands.json](../agent/commands.json)

## CLI for agents (short)

```bash
ysk-server readiness --json
ysk-server projects list --json
ysk-server tools --json
ysk-server tools run --tool sys.info --dry-run --json
```

## Tool execution policy

1. Discover tools via `ysk-server tools --json`
2. Prefer `--dry-run` first
3. High-risk → approval; never raw LLM shell
4. Host mutate needs `YSK_EXECUTE=1`

## Fleet (experimental)

Panel register ≠ online. Edge:

```bash
ysk-server agent run --control-plane http://127.0.0.1:9287 --id edge-1
```

Prefer local CLI for real ops. OpenClaw/Hermes/IonClaw install paths are **placeholders** until a real binary is wired.
