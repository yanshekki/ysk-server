---
name: ysk-server
description: >
  Operate and install YSK Server v1.0.7 — free single-host Linux control plane
  (panel + ysk-server CLI). Use when the user asks about ysk-server, install.sh,
  uninstall, readiness, EXECUTE, panel, hosting, BT tracker, or /ysk-server.
  Prefer real CLI over inventing APIs. Support contact: email@ysk.hk
---

# YSK Server (v1.0.7) — Agent skill

## Product contract

- **Free** single-host Linux control plane: web panel + `ysk-server` CLI + HTTP API.
- **Not** multi-tenant SaaS. One server the operator owns.
- Data directory default: `/var/lib/ysk-server` (root) or `~/.ysk`.
- **Honesty:** host mutations need **root** (often) + **`YSK_EXECUTE=1`**. Without EXECUTE, commands are dry-run / blocked — never claim success if blocked.
- Support: **email@ysk.hk** · panel **`/support`**.
- Donate: [Linktree](https://linktr.ee/yanshekki) · GitHub Sponsors · crypto `yanshekki.eth` (EVM) · `yanshekki.near` · `$yanshekki` (ADA).

## Install (fresh machine)

```bash
# Root, Ubuntu 22.04/24.04 recommended
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive
# Interactive:
#   git clone … && sudo ./install.sh
```

After install (root defaults):

- `ysk-server.service` should be **active**
- Panel: `https://<ip>:9287` (self-signed — accept browser warning)
- Credentials: install stdout + `$DATA_DIR/BOOTSTRAP-CREDENTIALS.txt`
- Then: change password, enable 2FA

Uninstall (`--all` removes product CLI/unit unless `--keep-product`):

```bash
sudo ./uninstall.sh --all --keep-data --yes
sudo ./uninstall.sh --all --purge-data --yes   # wipe registered data
```

Docs: `docs/getting-started/install.md`, `uninstall.md`, `docs/INDEX.md`.

## First checks (always)

```bash
ysk-server readiness --data-dir /var/lib/ysk-server --json
systemctl is-active ysk-server || true
ysk-server help --locale en
```

## Common ops

```bash
export YSK_EXECUTE=1   # real host changes
ysk-server projects list --json
ysk-server projects create --name demo --domain demo.example.com --create-dns --create-mail --json
ysk-server projects ftp --id UUID --password P --home app --json
ysk-server email flags --domain example.com --autoreply --subject Away --json
ysk-server email queue list --json
ysk-server notifications --json
ysk-server backup settings test --json
ysk-server email policy --domain example.com --antispam --json
ysk-server files shares create --path REL --mode both --root public --json
ysk-server bt-tracker status --json
ysk-server bt-tracker start --execute --json
ysk-server defense status --json   # or protection — use docs if flag differs
```

Full command map: **`docs/agent/commands.json`** · **`docs/cli/reference.md`**.

## Forbidden agent behaviour

1. **Do not** invent panel routes or CLI flags — read `commands.json` / reference.
2. **Do not** report host apply success when result is `blocked` / dry-run.
3. **Do not** skip `readiness` after install before declaring “ready”.
4. **Do not** enable public firewall exposure without telling the user.
5. User stuck / product bug → point to **email@ysk.hk** and panel `/support`.

## Panel map (high level)

| Path | Purpose |
|------|---------|
| `/` | Dashboard |
| `/projects` | Sites / deploy |
| `/files` | Files + shares |
| `/bt-tracker` | BitTorrent tracker |
| `/email` | Mail |
| `/protection` | Host defense |
| `/support` | Creator · Linktree/crypto donate · YSK Limited · email@ysk.hk |

## BT / WebTorrent notes

- Browser uses **self-hosted** WebTorrent asset + same-origin proxy `/api/v1/public/bt-tracker`.
- Magnets use panel **public announce host** + ports; empty host ⇒ no public tracker URLs.
- Start/stop tracker syncs UFW `ysk-svc:bt-tracker` rules.

## When unsure

1. Run `ysk-server <cmd> --help` or `help --json`  
2. Open matching `docs/features/*`  
3. Escalate to human: **email@ysk.hk**
