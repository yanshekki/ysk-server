# AI agents

> Language: English | [中文](./README-ZH.md)

## Rules

1. Prefer **CLI + `--json`**, not the experimental fleet UI alone.  
2. Start with `readiness` and read-only `list` commands before `--execute`.  
3. Parse `ok`, `blocked`, `dryRun`, `executed`, `notes`.  
4. Read [../cli/reference.md](../cli/reference.md) and [commands.json](./commands.json).

## Quick commands

```bash
ysk-server readiness --json
ysk-server projects list --json
ysk-server tools --json
ysk-server defense status --json
ysk-server email deliverability --domain example.com --json
ysk-server vpn status --json
ysk-server vnc status --json
ysk-server apache sites list --json
ysk-server network exposure list --json
ysk-server db status --json
ysk-server redis keys --json
ysk-server updates inventory --json
ysk-server runtimes list --json
```

Full catalog: [commands.json](./commands.json) · [../cli/reference.md](../cli/reference.md).

## Skill paste

Use [SKILL.md](./SKILL.md) for Cursor/Claude/Codex system prompts.

## Fleet (experimental)

```bash
ysk-server agents fleet list --json
ysk-server agent run --control-plane URL --id AGENT_ID
```

Registered ≠ connected until heartbeat. Queued ≠ applied on edge.

## Honesty

Never claim host apply without EXECUTE/root. Never guarantee global email inbox delivery.
