# YSK Server API Overview

Base URL: `http://127.0.0.1:9287`

## Core

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health + protection mode |
| GET | `/api/v1/status` | No | Product, tools, execute flag |
| POST | `/api/v1/auth/login` | No | Login |
| POST | `/api/v1/auth/logout` | Bearer | Logout |
| GET | `/api/v1/auth/me` | Bearer | Current user |
| GET | `/api/v1/users` | Admin | List users |
| GET | `/api/v1/audit` | Bearer | Audit log |
| GET | `/api/v1/metrics` | Bearer | Host metrics + alerts |

## Tools / security

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/tools` | Bearer | Allowlist catalog |
| POST | `/api/v1/tools/execute` | Bearer | Allowlist+RBAC+Approval tool run |
| GET | `/api/v1/approvals` | Bearer | Approval queue |
| POST | `/api/v1/approvals/:id/approve` | Bearer | Approve |
| POST | `/api/v1/protection` | Bearer | Set protection mode |

## AI (Plan → Review → Execute)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/ai/tasks` | Bearer | List AI tasks |
| POST | `/api/v1/ai/tasks` | Bearer | Create plan from natural language |
| POST | `/api/v1/ai/tasks/:id/approve` | Bearer | Approve steps |
| POST | `/api/v1/ai/tasks/:id/execute` | Bearer | Execute via tool gate |
| GET | `/api/v1/ai/playbooks` | Bearer | Built-in playbooks |
| POST | `/api/v1/ai/playbooks/run` | Bearer | Run playbook |
| POST | `/api/v1/ai/rca` | Bearer | Root-cause report from host facts |

## Projects / hosting

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/api/v1/projects` | Bearer | List / create (`templateId` optional) |
| GET | `/api/v1/templates` | Bearer | App templates catalog |
| POST | `/api/v1/projects/:id/template` | Bearer | Apply template to existing project |
| POST | `/api/v1/projects/:id/deploy` | Bearer | Real Node deploy (listen + health) |
| POST | `/api/v1/projects/:id/deploy-php` | Bearer | PHP built-in server + FPM pool files |
| POST | `/api/v1/projects/:id/stop` | Bearer | Stop managed process |
| GET | `/api/v1/projects/:id/health` | Bearer | Live health |
| GET | `/api/v1/projects/:id/status` | Bearer | System-truth status |
| POST | `/api/v1/projects/:id/publish-nginx` | Bearer | Nginx conf + optional reload |
| POST | `/api/v1/projects/:id/git-deploy` | Bearer | Git clone/pull + redeploy |
| POST | `/api/v1/projects/:id/deploy-static` | Bearer | Static site nginx root conf |
| PATCH | `/api/v1/cron/:id` | Bearer | Enable/disable cron job |
| POST | `/api/v1/hosting/dns/zone-file` | Bearer | Write BIND zone under dataDir/dns/zones |
| GET | `/api/v1/hosting/dns/zone-files` | Bearer | List managed zone files |
| GET | `/api/v1/readiness` | optional | Spec production readiness (503 if not ready) |
| POST | `/api/v1/hosting/files/apply` | Bearer | Public file server nginx |
| POST | `/api/v1/projects/:id/os-provision` | Bearer | Re-run Linux user isolation |
| GET | `/api/v1/hosting/dns/powerdns/status` | Bearer | Probe pdnsutil + list zones |
| POST | `/api/v1/hosting/dns/powerdns/install` | Bearer | Write install script / optional apt |
| POST | `/api/v1/hosting/dns/powerdns/load` | Bearer | Plan or load zone via pdnsutil |
| POST | `/api/v1/projects/:id/env` | Bearer | Write `.env` |
| POST | `/api/v1/projects/:id/backup` | Bearer | Tar backup |
| GET | `/api/v1/projects/:id/logs` | Bearer | List/tail logs |
| POST/GET | `/api/v1/projects/:id/quota` | Bearer | Soft disk quota |
| POST | `/api/v1/projects/:id/resources` | Bearer | systemd MemoryMax/CPUQuota |
| POST | `/api/v1/projects/:id/wordpress-download` | Bearer | WP core download (needs EXECUTE) |
| POST | `/api/v1/projects/:id/node-apply` | Bearer | Low-level unit+env write only |
| GET | `/api/v1/hosting/nginx` | Bearer | Managed nginx confs |
| POST | `/api/v1/hosting/nginx/sync` | Bearer | Sync nginx |
| POST | `/api/v1/hosting/db/probe` | Bearer | TCP probe |
| POST | `/api/v1/hosting/db/mysql-plan` | Bearer | SQL provision plan |
| POST | `/api/v1/hosting/db/mysql-provision` | Bearer | Real MySQL provision or refuse |
| POST | `/api/v1/hosting/db/postgres-provision` | Bearer | Real PG provision or refuse |
| POST | `/api/v1/hosting/db/redis-provision` | Bearer | Redis probe/PING or refuse |
| POST | `/api/v1/hosting/dns/plan` | Bearer | DNS zone plan |
| POST | `/api/v1/hosting/dns/cloudflare/apply` | Bearer | Cloudflare DNS apply |
| GET | `/api/v1/hosting/dns/zones` | Bearer | Stored zone apply results |
| GET | `/api/v1/dns/cluster/peers` | Bearer | DNS secondary peers |
| POST | `/api/v1/dns/cluster/peers` | Bearer | Upsert peer |
| DELETE | `/api/v1/dns/cluster/peers/:id` | Bearer | Delete peer |
| POST | `/api/v1/dns/cluster/push` | Bearer | scp zones (+ optional remote reload) |
| POST | `/api/v1/dns/cluster/reload` | Bearer | SSH remote nameserver reload |
| POST | `/api/v1/dns/cluster/probe` | Bearer | SSH peer health (named/bind9/pdns) |
| POST | `/api/v1/dns/lookup` | Bearer | dig / node-dns lookup |
| POST | `/api/v1/dns/validate` | Bearer | Record-set validation |
| GET/POST | `/api/v1/cdn/nodes` | Bearer | CDN node list / upsert (PR-C1) |
| GET/DELETE | `/api/v1/cdn/nodes/:id` | Bearer | Get / delete node |
| POST | `/api/v1/cdn/nodes/:id/probe` | Bearer | HTTP/TCP health probe |
| POST | `/api/v1/cdn/nodes/:id/drain` | Bearer | Drain / undrain |
| POST | `/api/v1/cdn/nodes/probe-all` | Bearer | Probe all nodes |
| POST | `/api/v1/hosting/firewall/plan` | Bearer | Firewall plan |
| GET | `/api/v1/hosting/files/plan` | Bearer | Public file server plan |
| GET | `/api/v1/backups` | Bearer | List backup archives |
| POST | `/api/v1/backups/run-all` | Bearer | Backup all projects |
| GET | `/api/v1/dashboard/summary` | Bearer | Ops summary |
| GET | `/api/v1/scheduler` | Bearer | In-process jobs |

## Email

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/api/v1/email/domains` | Bearer | Domains + DKIM |
| GET | `/api/v1/email/domains/:id/dns` | Bearer | DNS bundle |
| POST | `/api/v1/email/domains/:id/live-check` | Bearer | Live MX/SPF/DKIM/DMARC/PTR/Port25/DNSBL |
| POST | `/api/v1/email/domains/:id/test-send` | Bearer | Test send |
| GET | `/api/v1/email/mailboxes` | Bearer | List all mailboxes |
| GET | `/api/v1/email/domains/:id/mailboxes` | Bearer | List domain mailboxes |
| POST | `/api/v1/email/domains/:id/mailboxes` | Bearer | Provision Maildir + virtual map |
| POST | `/api/v1/email/domains/:id/dovecot-passdb` | Bearer | Export Dovecot passwd-file |
| POST | `/api/v1/email/dovecot-passdb/all` | Bearer | Export passdb for all domains |
| POST | `/api/v1/email/webmail/apply` | Bearer | Roundcube plan / optional download |
| POST | `/api/v1/email/bootstrap` | Bearer | Spec §5 one-click email stack bootstrap |
| GET | `/api/v1/hosting/runtimes` | Bearer | Probe Node/PHP multi-version |
| POST | `/api/v1/hosting/runtimes/install` | Bearer | Install script / optional apt |
| POST | `/api/v1/email/dnsbl/check` | Bearer | Multi-list DNSBL for IP |
| GET | `/api/v1/email/dnsbl/last` | Bearer | Last scheduled DNSBL run |
| POST | `/api/v1/email/warmup` | Bearer | Warm-up plan |
| POST | `/api/v1/email/domains/:id/warmup` | Bearer | Warm-up for domain |
| GET/POST | `/api/v1/email/relay` | Bearer | SMTP relay snippets |

## Agents / Updates / Fleet

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/agents/runtimes` | Bearer | Probe OpenClaw/Hermes/IonClaw |
| GET | `/api/v1/agents/runtimes/:kind` | Bearer | Single runtime probe |
| POST | `/api/v1/agents/runtimes/:kind/plan` | Bearer | Install plan |
| POST | `/api/v1/agents/runtimes/:kind/unit` | Bearer | Write systemd unit template |
| POST | `/api/v1/agents/runtimes/:kind/install` | Bearer | Install apply (EXECUTE optional) |
| GET | `/api/v1/updates/inventory` | Bearer | Package inventory + advice |
| POST | `/api/v1/updates/inventory/refresh` | Bearer | Force rescan (+ optional OSV) |
| GET | `/api/v1/updates/self` | Bearer | Self-update plan |
| GET/POST | `/api/v1/fleet/agents` | Bearer | Fleet list / register |
| POST | `/api/v1/fleet/agents/:id/heartbeat` | — | Heartbeat |
| GET/POST | `/api/v1/fleet/agents/:id/commands` | Bearer | Pull / enqueue commands |

## Protection (P7)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/protection/probe` | Bearer | Active network probes → auto protection mode + playbook suggestions |
| GET | `/api/v1/protection/status` | Bearer | Current mode, scheduler jobs, last probe/inventory |
| POST | `/api/v1/protection/emergency` | Bearer | Apply protection + run emergency playbook |

## Log Center

UI: `/logs`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/logs/overview` | Bearer | Disk MB + logrotate + settings + source counts |
| GET | `/api/v1/logs/sources` | Bearer | Catalog + custom allow paths |
| GET | `/api/v1/logs/journal/units` | Bearer | systemd service units |
| GET | `/api/v1/logs/journal/query` | Bearer | Safe journalctl query |
| GET | `/api/v1/logs/query` | Bearer | `source=journal:…\|file:…\|project:…` |
| GET | `/api/v1/logs/stream` | Bearer | SSE follow (poll under the hood) |
| GET | `/api/v1/logs/projects` | Bearer | All project log files index |
| POST | `/api/v1/logs/export` | Bearer | Export text/jsonl under dataDir |
| GET | `/api/v1/logs/export/:id` | Bearer | Download export (Bearer required) |
| POST | `/api/v1/logs/journal/vacuum` | Bearer | journal vacuum (EXECUTE+root) |
| GET/PUT | `/api/v1/logs/settings` | Bearer | Follow interval, auto-vacuum, paths, … |
| GET/POST | `/api/v1/logs/bookmarks` | Bearer | Saved queries |
| DELETE | `/api/v1/logs/bookmarks/:id` | Bearer | Remove bookmark |
| GET | `/api/v1/logs/logrotate` | Bearer | logrotate status tail |

## Defense Center (DDoS / attack)

UI: `/protection`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/defense/status` | Bearer | Threat level, signals, active preset, bans |
| POST | `/api/v1/defense/probe` | Bearer | Re-run probes + return status |
| POST | `/api/v1/defense/preset` | Bearer | Apply/preview preset (`daily`/`hardened`/`under_attack`/`emergency`) |
| GET | `/api/v1/defense/bans` | Bearer | List fail2ban + panel bans |
| POST | `/api/v1/defense/ban` | Bearer | Ban IP (`method`: fail2ban\|ufw\|both) |
| POST | `/api/v1/defense/unban` | Bearer | Unban IP |
| GET | `/api/v1/defense/timeline` | Bearer | Event timeline (`?hours=24`) |
| GET | `/api/v1/defense/suspects` | Bearer | Suspect IPs from access logs |
| POST | `/api/v1/defense/ban-batch` | Bearer | Batch ban IPs |
| GET/PUT | `/api/v1/defense/auto-ban` | Bearer | Auto-ban policy (legacy) |
| GET/PUT | `/api/v1/defense/automation` | Bearer | Full automation (preset + ban + weights + CF) |
| GET | `/api/v1/defense/intel` | Bearer | Top IPs + vhost limit markers |
| POST | `/api/v1/defense/cloudflare/under-attack` | Bearer | CF security_level under_attack |
| POST | `/api/v1/defense/whitelist` | Bearer | Add/remove whitelist IP |
| POST | `/api/v1/defense/auto-ban/tick` | Bearer | Run full automation tick |

## Files (sandbox)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/files?root=public&path=.` | Bearer | List directory |
| GET | `/api/v1/files/read?path=` | Bearer | Read text file |
| PUT | `/api/v1/files/write` | Bearer | Write text/base64 |
| POST | `/api/v1/files/mkdir` | Bearer | Create directory |
| DELETE | `/api/v1/files?path=` | Bearer | Delete path |

`root=public` → `dataDir/files/public`; `root=project:<id>` → project home.

## System-level apply

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/system/email/apply` | Bearer | Write Postfix/Dovecot/OpenDKIM configs; optional apt install |
| POST | `/api/v1/system/ssl/apply` | Bearer | Certbot plan / optional run |
| POST | `/api/v1/system/php/apply` | Bearer | PHP vhost + index under dataDir |
| POST | `/api/v1/system/ftps/apply` | Bearer | vsftpd config |
| POST | `/api/v1/system/fail2ban/apply` | Bearer | jail.local + optional install |
| POST | `/api/v1/ssl/upload` | Bearer | Upload PEM fullchain+key |
| GET | `/api/v1/ssl/uploaded` | Bearer | List managed cert files |
| GET | `/api/v1/system/ssl/certificates` | Bearer | Certificate apply history |
| POST | `/api/v1/system/firewall/apply` | Bearer | ufw/fail2ban plan / optional apply |
| POST | `/api/v1/system/nginx/site` | Bearer | Write site conf; optional reload |
| POST | `/api/v1/system/systemd/install` | Bearer | Control-plane unit template / enable |
| POST | `/api/v1/updates/self/apply` | Bearer | npm registry check + optional `npm i -g` |

Mutating system paths require **`YSK_EXECUTE=1`** and usually **root**. Without them, apply writes managed files under `dataDir` and returns copy commands.

LLM outputs are always `untrusted: true` and never execute without the tool gate.
