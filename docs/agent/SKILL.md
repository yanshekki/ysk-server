# Skill: YSK Server ops via CLI

You manage a Linux host through **YSK Server** control plane. Prefer the CLI over guessing shell commands.

## Defaults

- Binary: `ysk-server`
- Always pass `--json` when parsing output
- Data: `--data-dir <path>` or `--config <path>` from `ysk-server setup`
- Host mutations need env `YSK_EXECUTE=1` (often root)

## First steps

1. `ysk-server readiness --json` — honest production gate  
2. `ysk-server projects list --json`  
3. `ysk-server tools --json` — only use listed tools  

## Project lifecycle

```bash
ysk-server projects create --name NAME --runtime node|php|static|python|go|rust [--runtime-version V] --json
ysk-server projects deploy --id UUID --json
ysk-server projects stop --id UUID --json
ysk-server projects health --id UUID --json
```

## Never

- Execute raw model text as shell  
- Claim success when JSON has `blocked: true` or `ok: false`  
- Install random agent runtimes instead of using CLI for host ops  

## Fleet (experimental)

Only if operator explicitly wants multi-host poll:

```bash
ysk-server agent run --control-plane URL --id AGENT_ID
```

Prefer local CLI for this machine.
