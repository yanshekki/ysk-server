# YSK Server Security Architecture

## Principles

1. **Untrusted LLM** — model text never executes without policy gates
2. **Defense in depth** — Allowlist + Approval + RBAC + Sandbox
3. **Human-in-the-loop** for high-risk / destructive / privilege ops
4. **Fail closed** — unknown tools denied
5. **Auditability** — approvals, updates, agent commands recorded

## Allowlist

Code-level catalog. Default posture is **read-only**. Examples:

| Tool | Default | Approval |
|------|---------|----------|
| `fs.read` | allowed | no |
| `fs.write` | allowed | yes |
| `service.restart` | allowed | yes |
| `shell.exec` | **denied** | n/a |
| unknown | **denied** | n/a |

## Approval queue

High-risk tools create a pending approval; execute only after `approved`.

## RBAC (three-axis)

- **Role**: admin / operator / viewer / agent
- **Scope**: global / server / project (+ id)
- **Level**: read / write-low / write-high / destructive / privilege

Viewer is read-only. Agent is capped at write-low and cannot do write-high on global scope.

## Sandbox

Plans constrained execution: run-as user, allowed paths, network off by default, seccomp profile, resource limits.

## Protection mode

`normal` → `degraded` → `ddos-protection` → `offline` with local-LLM-only emergency playbooks.
