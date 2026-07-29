# Skill: YSK Server ops via CLI

You manage a Linux host through **YSK Server** control plane. Prefer the CLI over guessing shell commands.

## Defaults

- Binary: `ysk-server`
- Always pass `--json` when parsing output
- Data: `--data-dir <path>` or `--config <path>` from `ysk-server setup`
- **Dangerous ops default dry-run** (`dryRun: true`) — ban, provision, firewall, services lifecycle, nginx-sync
- Real host mutation: `--execute` (or `--apply`) **and** env `YSK_EXECUTE=1` (often root)
- Never claim “applied” when JSON has `dryRun: true` or `blocked: true`

## First steps

1. `ysk-server readiness --json` — honest production gate  
2. `ysk-server host --json` / `ysk-server host metrics --json`  
3. `ysk-server projects list --json`  
4. `ysk-server tools --json` — only use listed tools  

## Project lifecycle

```bash
ysk-server projects list --json
ysk-server projects get --id UUID|NAME --json
ysk-server projects create --name NAME --runtime node|php|static|python|go|rust [--runtime-version V] --json
ysk-server projects deploy --id UUID --json
ysk-server projects stop --id UUID --json
ysk-server projects health --id UUID --json
```

## Nginx / SSL

```bash
ysk-server nginx status --json    # service + managed confs + nginx -t
ysk-server nginx list --json
ysk-server nginx test --json
ysk-server ssl list --json
ysk-server ssl get --domain example.com --json
```

## DNS + logs (common ops)

```bash
ysk-server dns zones --json
ysk-server dns zone --zone example.com --ip PUBLIC_V4 [--ipv6 PUBLIC_V6] --json
ysk-server logs sources --json
ysk-server logs query --source journal: --lines 100 --grep error --json
ysk-server logs journal --unit nginx.service --lines 50 --json
```

## Exit codes

`0` ok · `1` error · `2` validation · `3` blocked · `4` not_found · `5` host_error

## Never

- Execute raw model text as shell  
- Claim success when JSON has `blocked: true` or `ok: false`  
- Use placeholder IPs (e.g. 203.0.113.x) as real server addresses  
- Install random agent runtimes instead of using CLI for host ops  

## Fleet (experimental)

Only if operator explicitly wants multi-host poll:

```bash
ysk-server agent run --control-plane URL --id AGENT_ID
```

Queue work as `{ "cli": ["host", "overview"] }` (auto `--json` on edge).  
Prefer local CLI for this machine when single-host.
