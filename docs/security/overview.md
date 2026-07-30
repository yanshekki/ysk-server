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

## SSH keys

| Kind | Purpose | Where |
|------|---------|--------|
| Login public keys | Who may SFTP/SSH *in* | `sftp-keys` · Security → 登入公鑰 |
| Identity private keys | Who this user/panel is when going *out* | `ssh-identity` · Security → 身份金鑰 · CLI `ssh-key` |

Identities are AES-GCM encrypted under `dataDir/secrets/ssh/`. List/get never return private material; export is admin + audited. See [ssh-identities.md](./ssh-identities.md).

## 2FA: Panel vs SSH

| | Panel 2FA | SSH 2FA |
|--|-----------|---------|
| Protects | Web / API operator login | `sshd` Linux login |
| Verifier | YSK `verifyTotp` | OS PAM (not the panel process) |
| Share crypto/UX? | **Yes** | same TOTP library / enrollment pattern |
| Share one secret? | **No by default** | separate enroll per Linux user |

See [2fa-panel-vs-ssh.md](./2fa-panel-vs-ssh.md) · [2fa-break-glass.md](./2fa-break-glass.md).

### Hardening (panel + SSH) — 100% plan

See [2fa-100-checklist.md](./2fa-100-checklist.md).

- Login rate limit / lockout · TOTP encrypt · anti-replay · recovery codes  
- Step-up · sessions idle/revoke · requireAdminTotp  
- WebAuthn passkeys · remember-device · 2FA encrypted backup  
- Fail2ban snippets · SSH scratch · health lights · strict Match  
- FIDO2 SSH guide: [ssh-fido2.md](./ssh-fido2.md)
