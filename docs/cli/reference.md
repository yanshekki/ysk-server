# YSK Server CLI Reference

**Binary**: `ysk-server`  
**Package**: `@ysk/server` (monorepo) / root bin after `pnpm build`  
**For AI agents**: [docs/agent/README.md](../agent/README.md) · [commands.json](../agent/commands.json)

## Global

```bash
ysk-server --help
ysk-server --version
ysk-server -V
ysk-server <command> --json          # structured JSON for AI agents
ysk-server <command> --data-dir PATH # many commands accept dataDir
ysk-server <command> --config PATH   # config.json from setup
```

### Exit codes (AI contract)

| Code | Meaning |
|------|---------|
| 0 | ok |
| 1 | error |
| 2 | validation / bad args |
| 3 | blocked (no EXECUTE / root / permission) |
| 4 | not found |
| 5 | host command failed |

Prefer `--json`; parse `ok`, `blocked`, `dryRun`, `executed`, `message`, `notes`.

### Safety (dangerous ops)

CLI **defaults to dry-run** for host mutations. JSON will include `dryRun: true` and a plan; exit `0` means the plan is valid, **not** that the host changed.

| Flag | Meaning |
|------|---------|
| *(none)* | dry-run / plan only |
| `--execute` | attempt real mutation |
| `--apply` | alias of `--execute` (legacy firewall) |

Still requires env `YSK_EXECUTE=1` (and often root). Without it, expect `blocked: true` / exit `3`.

Covered: `defense ban|unban`, `*provision`, `firewall-apply`, `services start|stop|restart|reload`, `nginx-sync`, install/load flags (`--install` / `--load` also accepted).

Environment:

| Variable | Purpose |
|----------|---------|
| `YSK_EXECUTE=1` | Allow mutating host commands (apt, systemctl enable, DB provision, WP download, …) |
| `YSK_ADMIN_PASSWORD` | Initial admin password on first boot |
| `YSK_WEB_ROOT` | Override Web UI dist path for `serve` |
| `YSK_DNSBL_ON_START=1` | Run DNSBL job on serve start |
| `YSK_BACKUP_ON_START=1` | Run project backups on start |

---

## setup

Initialize control-plane data directory, admin user, systemd unit template.

```bash
ysk-server setup [--data-dir PATH] [--host HOST] [--port PORT]
                 [--locale zh-TW|en|zh-CN] [--non-interactive]
                 [--dry-run] [--force]
```

## serve

Start HTTP API + packaged Web UI (if `apps/web/dist` built).

```bash
ysk-server serve [--config PATH] [--data-dir PATH]
                 [--host 127.0.0.1] [--port 9287] [--web-root PATH]
```

## update

Self-update check / apply (apply needs network + `YSK_EXECUTE=1`).

```bash
ysk-server update [--check] [--latest VERSION] [--apply] [--json]
```

## system unit-install

Write / optionally enable control-plane systemd unit.

```bash
ysk-server system unit-install [--data-dir PATH] [--enable]
# enable needs root + YSK_EXECUTE=1
```

## templates

List one-click app templates (`node-starter`, `static-site`, `wordpress-php`).

```bash
ysk-server templates [--json]
```

## host

Read-only host overview (identity, OS, load, memory, disks, network, caps).

```bash
ysk-server host [--json]                 # = overview
ysk-server host overview [--json]
ysk-server host metrics [--path /] [--json]   # exit 1 if alerts (memory/disk/load high)
```

## services

Host service matrix (real `systemctl` probe). Lifecycle needs `YSK_EXECUTE=1` + root.

```bash
ysk-server services matrix [--json]
ysk-server services start|stop|restart|reload --unit nginx [--execute]
```

Lifecycle without `--execute` returns dry-run plan only.

## defense | protection

```bash
ysk-server defense status [--json]
ysk-server defense ban --ip IP [--method fail2ban|ufw|both] [--reason t] [--execute]
ysk-server defense unban --ip IP [--method fail2ban|ufw|both] [--execute]
ysk-server defense whitelist --action list|add|remove [--ip IP]
```

Default: dry-run plan. Real ban/unban: `--execute` + `YSK_EXECUTE=1` (+ root for ufw). Whitelist is panel policy.

## projects

```bash
# list
ysk-server projects list [--data-dir PATH] [--json]

# get by id (or name / domain)
ysk-server projects get --id UUID|NAME [--json]

# create (+ optional template scaffold)
ysk-server projects create --name NAME \
  [--domain D] [--runtime node|php|static] \
  [--template node-starter|static-site|wordpress-php] \
  [--runtime-version VER] [--force] [--data-dir PATH]

# ops
ysk-server projects deploy --id UUID [--data-dir PATH]
ysk-server projects stop --id UUID
ysk-server projects health --id UUID
ysk-server projects backup --id UUID
ysk-server projects template --id UUID --template ID [--force]
```

Deploy selects Node / PHP / static from project runtime. Node: systemd → PM2 → pidfile. PHP: FPM+nginx → `php -S`. Static: nginx root conf (`--reload` for system). Flags: `--fpm` / `--builtin` / `--reload`.

## nginx

```bash
ysk-server nginx status [--json]     # systemctl + managed confs + nginx -t
ysk-server nginx list [--json]       # managed conf.d under dataDir
ysk-server nginx test [--json]       # nginx -t (exit 5 on fail)
ysk-server nginx sync [--execute]    # dry-run by default; same as hosting nginx-sync
```

## ssl

```bash
ysk-server ssl list [--json]
ysk-server ssl get --domain example.com [--json]
```

Read-only views of managed certs (`dataDir/certs` + registry). No LE apply here.

## db-cluster (engine HA, plan-first)

```bash
ysk-server db-cluster list [--engine mariadb] [--json]
ysk-server db-cluster get --id UUID [--json]
ysk-server db-cluster create --name g1 --engine mariadb --kind mariadb-galera \
  --member 10.0.0.1=node:local --member 10.0.0.2=node:ssh [--sst mariabackup] [--json]
ysk-server db-cluster plan --id UUID [--json]    # always dry-run; writes dataDir/clusters/
ysk-server db-cluster apply --id UUID [--execute] [--bootstrap] [--json]
ysk-server db-cluster probe --id UUID [--json]   # local wsrep status
ysk-server db-cluster artifacts --id UUID [--json]
ysk-server db-cluster bundle --id UUID [--json]  # tar.gz under dataDir
ysk-server db-cluster push --id UUID [--member ID] [--execute] [--json]
ysk-server db-cluster probe --id UUID [--peers] [--json]
ysk-server db-cluster install-peers --id UUID [--execute] [--json]
ysk-server db-cluster fleet --id UUID [--op apply|probe|plan|sync] [--execute] [--edge-execute]
ysk-server db-cluster overview [--json]
ysk-server db-cluster delete --id UUID [--json]
```

Member: `--member HOST=role:access` · fleet `--member 10.0.0.3=replica:fleet:SESSION_UUID`

| 命令 | 說明 |
|------|------|
| `probe --peers` | 本機 + SSH peer 探測 → 可達 `healthy` |
| `install-peers --execute` | scp conf 後 peer 上 install + restart |
| `fleet --op sync --execute` | 同步 cluster 快照到邊緣（edge agent 支援 clusterSync） |
| `push --execute` | 只 scp 到 `/tmp` |
| `bundle` | 下載用 tar.gz |

Panel: 各引擎 **服務 → 叢集**（全節點探測 / 遠端安裝 / Fleet 同步）.

## ssh-key (identity vault)

Encrypted **outbound** SSH private keys (Linux user / panel). Distinct from SFTP **login** public keys.

See [docs/security/ssh-identities.md](../security/ssh-identities.md).

```bash
ysk-server ssh-key list [--user U] [--purpose user|panel|unbound] [--json]
ysk-server ssh-key create --name N [--algo ed25519|rsa-4096] [--purpose user|panel] \
  [--project ID] [--user U] [--home PATH] [--reveal] [--install] [--execute] [--json]
ysk-server ssh-key import --name N --file PATH [--purpose panel] [--json]
ysk-server ssh-key public --id UUID
ysk-server ssh-key export --id UUID [--out PATH] [--json]
ysk-server ssh-key install --id UUID [--execute] [--json]   # dry-run default
ysk-server ssh-key test --id UUID --target user@host[:port] [--execute] [--json]
ysk-server ssh-key rotate --id UUID [--reveal] [--json]
ysk-server ssh-key authorize-self --id UUID [--json]
ysk-server ssh-key uninstall --id UUID [--execute] [--json]
ysk-server ssh-key delete --id UUID [--purge-disk] [--json]
```

| 命令 | 說明 |
|------|------|
| `create --reveal` | one-time 回傳 private（列表永不含 private） |
| `install --execute` | 寫入 home 或 `dataDir/secrets/ssh/keys/`；需 `YSK_EXECUTE=1` |
| `test --execute` | `ssh -i … user@host true` → status verified |
| `rotate` | 舊 key retired + 新 key |
| `authorize-self` | 公鑰寫入 binding 用戶 authorized_keys |
| `export` | 解密 private；HTTP 層限 admin + audit |

Cluster / backup 消費：`db-cluster push|probe|install-peers --identity ID`；`backup_remote.identityId`。

Panel: **安全 → 身份金鑰** · 專案資源 tab SSH 小卡

## ssh-2fa (SSH login TOTP ≠ panel 2FA)

```bash
ysk-server ssh-2fa list [--user U] [--project ID] [--json]
ysk-server ssh-2fa enroll --user LINUX|--project ID [--from-panel] [--json]
ysk-server ssh-2fa confirm --id UUID --code 123456 [--json]
ysk-server ssh-2fa install --id UUID [--execute] [--json]
ysk-server ssh-2fa uninstall --id UUID [--execute] [--json]
ysk-server ssh-2fa pam [--json]
ysk-server ssh-2fa retire --id UUID [--purge-file] [--json]
```

Independent TOTP per Linux user; writes `~/.google_authenticator`. PAM uses **nullok**. See [docs/security/2fa-panel-vs-ssh.md](../security/2fa-panel-vs-ssh.md).

Panel: **安全 → SSH → 登入 2FA**

## hosting

```bash
ysk-server hosting nginx|nginx-list
ysk-server hosting nginx-sync [--system-dir PATH] [--dry-run]

ysk-server hosting nginx-sync [--execute] [--system-dir PATH]
ysk-server hosting redis-provision [--project-id ID] [--db N] [--execute]
ysk-server hosting postgres-provision --db NAME --user USER --password PASS [--execute]
ysk-server hosting mysql-provision --db NAME --user USER --password PASS [--execute]
ysk-server hosting dns-zone --zone example.com --ip A.B.C.D [--ipv6 X:X::X] [--validate] [--reload]
ysk-server hosting dns-zones
ysk-server hosting powerdns-status
ysk-server hosting powerdns-install [--install|--execute]
ysk-server hosting powerdns-load --zone example.com --ip A.B.C.D [--ipv6 X:X::X] [--load|--execute]
ysk-server hosting email-apply --domain example.com [--install|--execute]
ysk-server hosting email-mailbox --domain example.com --local info [--password P] [--ip A.B.C.D] [--system]
ysk-server hosting ftps-apply --domain files.example.com [--install|--execute]
ysk-server hosting runtimes
ysk-server hosting runtime-install --kind node --version 20 [--install|--execute]
ysk-server hosting dovecot-passdb --domain example.com
ysk-server hosting webmail-apply --domain webmail.example.com
ysk-server hosting firewall-apply [--smtp] [--execute]
```

`--zone` / `--ip` are **required** (no TEST-NET / example.com defaults). Optional `--ipv6` writes dual-stack AAAA.

Provision / firewall / nginx-sync default **dry-run**; add `--execute` + `YSK_EXECUTE=1` to apply.

### dns (AI alias)

```bash
ysk-server dns zones [--json]
ysk-server dns zone --zone example.com --ip A.B.C.D [--ipv6 X:X::X] [--validate] [--reload] [--json]
```

### logs

```bash
ysk-server logs sources [--json]
ysk-server logs overview [--json]
ysk-server logs units [--json]
ysk-server logs journal [--unit nginx.service] [--lines N] [--grep G] [--since 1h] [--priority err]
ysk-server logs query --source journal:|file:…|project:<uuid> [--lines N] [--grep G] [--since 1h]
```

`--execute` still requires `YSK_EXECUTE=1` and the matching client (`redis-cli` / `psql` / `mysql`). Without it, commands return structured failure + plan (never fake success).

## tools

```bash
ysk-server tools --json
ysk-server tools run --tool <name> [--arg key=val] [--dry-run]
```

## ask

Natural-language task plan (optional `--execute` after approval wiring).

```bash
ysk-server ask "check system info" [--execute] [--config PATH]
```

## agents

```bash
ysk-server agents --json              # catalog
ysk-server agents --probe             # host path/systemd probe
ysk-server agents probe --data-dir PATH
```

## agent run

Outbound fleet agent worker (polls control plane).

```bash
ysk-server agent run --control-plane URL --id AGENT_ID [--group g] [--interval MS]
```

---

## AI-agent friendly output

Prefer `--json`. Successful shapes typically include `ok`, and for CLI ops either a DTO payload or `{ ok, items }`. Errors print to stderr with non-zero exit.

## Related docs

- [production-mvp.md](../deploy/production-mvp.md)
- [real-ops.md](../deploy/real-ops.md)
- [npm-publish.md](../deploy/npm-publish.md)
- [API overview](../api/overview.md)
