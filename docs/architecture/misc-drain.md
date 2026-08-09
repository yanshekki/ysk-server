# misc.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

## Moved out (domain ownership)

| Domain | Module |
|--------|--------|
| users / packages | `routes/admin.ts` |
| search | `routes/search.ts` |
| audit | `routes/audit.ts` |
| real-ip / system ips | `controllers/system-controller.ts` |
| DNSSEC | `routes/dns.ts` |
| SFTP / SSH identity / 2FA | `routes/ssh.ts` |
| project deploy + ops | `routes/projects.ts` |
| agent runtime plan/install | `routes/agents.ts` |

## Still residual in misc (~1.1k LOC)

- dashboard / notifications
- email domain mailboxes/aliases/flags (partial)
- hosting runtime tuning
- AI task approve/execute
- db temp-users / cluster fleet helpers
- SMTP relay / miscellaneous apply helpers

Prefer **new code in domain modules**, not misc.
