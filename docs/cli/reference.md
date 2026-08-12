# CLI reference

> Language: English | [中文](./reference-ZH.md)

**Binary:** `ysk-server`  
**See also:** [overview.md](./overview.md) · [parity.md](./parity.md) · [../agent/commands.json](../agent/commands.json)

Global flags and exit codes: [overview.md](./overview.md).

Unless noted, add `--json` and `--data-dir PATH` as needed.

---

## setup

Initialize `dataDir`, config, document store, admin user, systemd unit template.

```bash
ysk-server setup --data-dir /var/lib/ysk [--admin-username U] [--admin-password P] [--listen-host 127.0.0.1] [--listen-port 9287] [--locale zh-HK] [--dry-run] [--force] [--json]
```

Weak/default passwords rejected unless `YSK_ALLOW_INSECURE_DEFAULTS=1` (dev only).

## serve

Start HTTP API + static Web UI (if `apps/web` built).

```bash
ysk-server serve [--config PATH] [--data-dir PATH] [--host 127.0.0.1] [--port 9287] [--web-root PATH]
```

## update

Self-update check / apply (apply needs network + EXECUTE).

```bash
ysk-server update [--check] [--latest VERSION] [--apply] [--json]
```

## system

```bash
ysk-server system unit-install [--enable] [--data-dir PATH] [--execute]
```

Writes control-plane systemd unit; enable/start needs root + EXECUTE.

## version | help

```bash
ysk-server version
ysk-server help [--locale zh-HK|zh-CN|en]
```

---

## projects

```bash
ysk-server projects list
ysk-server projects get --id UUID
ysk-server projects create --name NAME --domain D [--runtime node|php|static|…]
ysk-server projects deploy --id UUID [--entry FILE] [--port N] [--fpm] [--execute]
ysk-server projects stop --id UUID [--execute]
ysk-server projects health --id UUID
ysk-server projects backup --id UUID
ysk-server projects git-deploy --id UUID [--ref BRANCH] [--execute]
ysk-server projects isolation list|provision|provision-all|backfill-owners …
ysk-server projects template …
```

Host deploy paths: systemd → PM2 → pidfile (Node); FPM or `php -S` (PHP); nginx root (static). See [../features/projects.md](../features/projects.md).

## templates

List / apply app scaffolds (node-starter, static-site, wordpress-php, …).

```bash
ysk-server templates list|apply …
```

## hosting

Low-level hosting helpers (default dry-run):

```bash
ysk-server hosting nginx|nginx-sync [--execute]
ysk-server hosting mysql-provision|postgres-provision|redis-provision [--execute]
ysk-server hosting dns-zone --zone X --ip A.B.C.D …
ysk-server hosting email-bootstrap|email-deliverability|email-apply …
ysk-server hosting ftps-apply|firewall-apply|runtimes|runtime-install|runtime-switch|runtime-uninstall …
```

Prefer top-level `runtimes` / `ftp` / `apache` where available. Run `ysk-server hosting` for the full sub list.

## nginx | ssl | dns

```bash
ysk-server nginx status|list|test|sync [--execute]
ysk-server ssl list|get|bootstrap|panel-tls status|enable|disable|issue …
ysk-server dns zones|zone|dnssec|heal|health|lookup|records …
```

`dns` covers managed zones, DNSSEC, PowerDNS heal, lookup/validate.

## backup

```bash
ysk-server backup list [--q TEXT]
ysk-server backup status
ysk-server backup all [--side …]
ysk-server backup restore …
ysk-server backup delete …
ysk-server backup schedule [--install] [--execute]
ysk-server backup control-plane
ysk-server backup settings get|set …
ysk-server backup restic …
```

## store

```bash
ysk-server store status|export|import|migrate --to json|sqlite|postgres …
```

See [../architecture/state-store.md](../architecture/state-store.md).

## files

Sandboxed file manager (public or `project:ID` root):

```bash
ysk-server files list|stat|read|write|mkdir|rm|rename|copy|move|chmod …
ysk-server files trash list|restore|purge
ysk-server files shares list|create|delete|bt-stats
ysk-server files upload --dir REL --file LOCAL
ysk-server files webdav status|token|disable
```

```bash
ysk-server files shares create --path REL [--mode direct|bt|both] [--password …] [--expires ISO] --root public
ysk-server files shares bt-stats --id SHARE_ID
ysk-server files shares delete --id SHARE_ID
```

`--mode bt|both` creates a `.torrent`, seeds in-process (WebTorrent), and needs a running tracker (`bt-tracker start`). Public `/share/:token` shows **direct** and/or **BT** actions by mode (no English “direct disabled” banner). Browser WebTorrent uses a **self-hosted** panel asset and same-origin tracker proxy (`/api/v1/public/bt-tracker`).

## bt-tracker

Self-hosted [bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker) for file-share magnets / WebTorrent.

```bash
ysk-server bt-tracker status|info
ysk-server bt-tracker settings get|show
ysk-server bt-tracker settings set|patch \
  [--http-port N] [--udp-port N] [--listen-host H] [--public-host H] \
  [--ws|--no-ws] [--autostart|--no-autostart]
ysk-server bt-tracker start [--execute]   # detached worker + pid (survives CLI exit)
ysk-server bt-tracker stop                # also clears ysk-svc:bt-tracker UFW rules
ysk-server bt-tracker torrents|stats      # live swarm (in-process preferred)
ysk-server bt-tracker restore             # re-seed BT shares (+ start tracker if needed)
ysk-server bt-tracker jobs [--id JOB_ID]  # large-share create-torrent queue
```

| Topic | Behaviour |
|-------|-----------|
| Default port | HTTP/WS **8000**; optional UDP (e.g. 6969) |
| Public host | `settings set --public-host` → magnets/announce. **Empty ⇒ no public tracker URLs** (not `127.0.0.1`) |
| Start | Detached worker; **`syncServiceExposure` reason=start** (desired ports HTTP + UDP if set) |
| Stop | Kill worker/in-process; **exposure reason=stop** |
| Settings while stopped | Updates JSON + desired port list only |
| Settings while running | Same, but **restart tracker** to re-bind listen ports |
| Browser guests | Same-origin **`wss?://panel/api/v1/public/bt-tracker`** proxies to local tracker (HTTPS-safe) |
| Serve boot | Autostart and/or existing BT shares → `restoreBtSharesOnBoot` |

Panel Start keeps the tracker **in the serve process** (same seeder). See [features/bt-tracker.md](../features/bt-tracker.md).

## cron

```bash
ysk-server cron list|create|delete|enable|disable|run|install|status …
```

Install crontab needs EXECUTE.

## email

```bash
ysk-server email domains list|create|get …
ysk-server email mailboxes list|create …
ysk-server email aliases list|create|delete --domain example.com …
ysk-server email queue list|flush [--all|--id ID] [--execute]
ysk-server email relay get|apply --host smtp.example.com [--execute]
ysk-server email deliverability --domain example.com
ysk-server email bootstrap --domain D --ip A.B.C.D [--install]
ysk-server email dns --domain D
```

PTR / Port 25 remain external. See [../features/email.md](../features/email.md).

## users | packages | rbac | audit | security

```bash
ysk-server users list|create …
ysk-server packages list
ysk-server rbac list|show|audit
ysk-server audit [--q TEXT] [--limit N]
ysk-server security status
ysk-server security sessions list|revoke|revoke-others [--user U]
ysk-server security api-keys list|create|delete …
```

## ssh-key | ssh-2fa

```bash
ysk-server ssh-key list|create|import|public|export|install|delete …
ysk-server ssh-2fa list|enroll|confirm|install|pam|retire …
```

SSH TOTP ≠ panel TOTP.

## defense | protection

```bash
ysk-server defense status|firewall|fail2ban|ban|unban|whitelist|stack-apply|presets|timeline …
ysk-server protection …   # alias of defense
```

## cdn

```bash
ysk-server cdn nodes list|upsert|delete|probe|drain …
ysk-server cdn sites list|get|upsert|delete …
ysk-server cdn render|apply|purge|dns-sync|from-project|dashboard|health-loop …
```

## agents | agent

```bash
ysk-server agents runtimes|probe|fleet list|fleet register|fleet commands|register|commands …
ysk-server agent run --control-plane URL --id AGENT_ID [--group g]
```

Fleet: registered ≠ connected until heartbeat. Enqueue needs Bearer; public poller paths limited.

## logs | host | health | readiness | doctor | services | metrics via host

```bash
ysk-server logs sources|query|journal|overview …
ysk-server host overview|metrics|network …
ysk-server health [--url http://host:port/health]
ysk-server readiness|doctor [--json]
ysk-server services …
ysk-server db-cluster list|get|create|plan …
```

## migrate

```bash
ysk-server migrate inventory|host|post|status|resume …
```

## tools | ask

```bash
ysk-server tools [--json]
ysk-server tools run --tool NAME [--arg k=v] [--dry-run|--execute]
ysk-server ask "natural language" [--execute]
```

Tools respect allowlist + protection mode.

---

## vpn

Open-source VPN on the control-plane host (WireGuard / OpenVPN / Outline-style ss-server).

| Sub | Purpose | `--execute`? |
|-----|---------|--------------|
| `status` | Engines, peers, client profiles | no |
| `monitor` | Live transfer snapshot | no |
| `presets` | Port presets | no |
| `ensure` | Ensure server config | **yes** |
| `peers list\|add\|delete\|config` | Server peers | add/delete **yes** |
| `clients list\|import\|up\|down\|delete\|autostart` | Local client profiles | up/down/delete **yes** |
| `firewall open` | Open port via service exposure | **yes** |

```bash
ysk-server vpn status --json
ysk-server vpn peers list --engine wireguard --json
ysk-server vpn ensure --engine wireguard --port 51820 --execute --json
ysk-server vpn peers add --name laptop --execute --json
ysk-server vpn clients import --name office --file ./wg.conf --json
```

See [../features/vpn.md](../features/vpn.md).

## vnc

TigerVNC accounts, client profiles, share links, noVNC. **Browser canvas remains panel-only.**

| Sub | Purpose | `--execute`? |
|-----|---------|--------------|
| `status` / `settings` | Stacks + defaults | set settings = panel data |
| `accounts list\|create\|update\|password\|start\|stop\|delete` | Account lifecycle | create/start/stop/delete **yes** |
| `connection` / `firewall` / `novnc` | Connect info / UFW / noVNC | firewall/novnc **yes** |
| `clients …` | Outbound profiles | up/down **yes** |
| `share create\|info\|revoke` | Share links | no (panel store) |
| `session mint` | RFB metadata for operators | may need execute to start desktop |

```bash
ysk-server vnc status --json
ysk-server vnc accounts list --json
ysk-server vnc accounts create --name alice --execute --json
ysk-server vnc share create --id ACCOUNT_ID --json
```

See [../features/vnc.md](../features/vnc.md).

## apache

Apache sites + global settings (unique panel entry `/apache`).

```bash
ysk-server apache sites list|create|update|delete|apply|conf|cleanup-conflicts …
ysk-server apache settings get|set|apply [--execute]
```

See [../features/apache.md](../features/apache.md).

## network | real-ip

Service network exposure (`ysk-svc` comments) and CDN real-IP trust.

```bash
ysk-server network exposure list|get|put|sync --service ID …
ysk-server real-ip status|set|refresh [--execute]
```

See [../features/system-host.md](../features/system-host.md).

## updates | software | stack

```bash
ysk-server updates inventory|refresh|apply|apply-batch|summary|self …
ysk-server software list|get|install|uninstall|uninstall-preview|upgrades|versions …
ysk-server stack plans|bundles|status|install|scan …
ysk-server update [--check] [--apply]   # panel binary self-update
```

`update` = product self-update; `updates` = host package inventory. See [../features/system-host.md](../features/system-host.md).

## db | redis | db-cluster

```bash
ysk-server db status|console|apply|lifecycle|install --engine mysql|mariadb|postgres|redis …
ysk-server db sql-engine preview|switch --target mysql|mariadb …
ysk-server redis status|settings|keys|get|set|del|install|start …
ysk-server db-cluster list|get|create|plan|apply|probe …
```

See [../features/databases.md](../features/databases.md).

## ftp

```bash
ysk-server ftp status|settings|accounts|options|apply …
ysk-server ftp accounts list|create|update|delete|apply …
```

See [../features/files-ftp.md](../features/files-ftp.md).

## runtimes

```bash
ysk-server runtimes list|install|switch|uninstall --kind node|php|python|go|rust|java|kotlin|bun …
ysk-server hosting runtime-install|runtime-switch|runtime-uninstall …
```

Kinds include **java**, **kotlin**, **bun**. See [../features/runtimes.md](../features/runtimes.md).

---

## Feature docs

| Command area | Feature page |
|--------------|--------------|
| projects, templates, hosting | [../features/projects.md](../features/projects.md) |
| email | [../features/email.md](../features/email.md) |
| files, ftp | [../features/files-ftp.md](../features/files-ftp.md) |
| backup, cron | [../features/backups-cron.md](../features/backups-cron.md) |
| security, users, rbac | [../features/security-auth.md](../features/security-auth.md) · [../features/users-rbac.md](../features/users-rbac.md) |
| defense | [../features/defense.md](../features/defense.md) |
| cdn, agents | [../features/cdn-agents.md](../features/cdn-agents.md) |
| logs, host | [../features/logs-metrics.md](../features/logs-metrics.md) |
| vpn | [../features/vpn.md](../features/vpn.md) |
| vnc | [../features/vnc.md](../features/vnc.md) |
| apache | [../features/apache.md](../features/apache.md) |
| db, redis, runtimes | [../features/databases.md](../features/databases.md) · [../features/runtimes.md](../features/runtimes.md) |
| network, updates, software | [../features/system-host.md](../features/system-host.md) |
| store, readiness | [../architecture/state-store.md](../architecture/state-store.md) · [../getting-started/readiness.md](../getting-started/readiness.md) |


---

## High-frequency flags (detail)

### setup

| Flag | Meaning |
|------|---------|
| `--data-dir PATH` | Control-plane directory (created if missing) |
| `--admin-username` / `--admin-password` | First admin |
| `--listen-host` / `--listen-port` | Default bind for serve |
| `--locale zh-HK\|zh-CN\|en` | Admin + default UI locale |
| `--dry-run` | Print plan only |
| `--force` | Allow re-run paths where safe |
| `--json` | Structured result |

### projects deploy

| Flag | Meaning |
|------|---------|
| `--id UUID` | Project id |
| `--entry FILE` | Node entry (e.g. server.js) |
| `--port N` | Listen port |
| `--fpm` | Prefer PHP-FPM path |
| `--execute` | Real deploy (needs EXECUTE; systemd needs root) |

Without `--execute`: plan / write managed unit files only.

### backup

| Sub | Notes |
|-----|--------|
| `list` / `status` | Read-only inventory |
| `all` | Full backup pass |
| `schedule --install` | Install schedule (EXECUTE) |
| `control-plane` | Backup control-plane state |
| `restic …` | Restic helpers when configured |
| `settings get\|set` | Remote / exclusion settings |

### email deliverability

| Flag | Meaning |
|------|---------|
| `--domain` or domain id | Target mail domain |
| `--json` | Items + honesty notes |

Never claims global inbox success.

### security

| Sub | Meaning |
|-----|---------|
| `status` | 2FA flags, admin counts |
| `sessions list\|revoke\|revoke-others` | Session admin by `--user` |
| `api-keys list\|create\|delete` | Operator API keys; token once on create |

### defense

| Sub | Meaning |
|-----|---------|
| `status` | Stack snapshot |
| `firewall` / `fail2ban` | Subsystem status / plan |
| `ban` / `unban` / `whitelist` | IP actions (EXECUTE for live) |
| `stack-apply` / `presets` / `timeline` | Defense center ops |

### store

| Sub | Meaning |
|-----|---------|
| `status` | Backend kind + counts |
| `export` / `import` | Document snapshot JSON |
| `migrate --to json\|sqlite\|postgres` | Backend switch |

### readiness / doctor

Read-only production gate. Exit non-zero when not production-ready (JSON still useful).

```bash
ysk-server readiness --json
ysk-server doctor --json
```
