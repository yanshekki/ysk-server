# misc.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

## Moved out (domain ownership)

| Domain | Module |
|--------|--------|
| users / packages | `routes/admin.ts` |
| search | `routes/search.ts` |
| audit | `routes/audit.ts` |
| real-ip / system ips | `controllers/system-controller.ts` |
| DNSSEC / DNS cluster | `routes/dns.ts` |
| SFTP / SSH identity / 2FA | `routes/ssh.ts` |
| project deploy + ops | `routes/projects.ts` |
| agent runtime plan/install | `routes/agents.ts` |
| dashboard / notifications / apply-audit | `routes/dashboard.ts` (M1) |
| email domains / mailboxes / aliases / … | `routes/email.ts` (M2) |
| hosting runtime tuning | `routes/hosting.ts` (M3) |
| AI tasks / playbooks residual | `routes/ai.ts` (M3) |
| SSL certificates residual | `routes/ssl.ts` (M3) |
| CDN nodes / sites residual | `routes/cdn.ts` (M3) |
| DB adminer / clusters residual | `routes/db.ts` (M3) |

## Residual

`routes/misc.ts` is a **thin stub** (`handleMiscRoutes` always returns `false`).
`misc.test.ts` remains an integration suite over the full HTTP stack (paths now owned by domain modules).

Prefer **new code in domain modules**, not misc.
