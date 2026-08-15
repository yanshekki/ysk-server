# Projects

> Language: English | [中文](./projects-ZH.md)

## Purpose

First-class **sites** on the host: create, deploy, stop, health, git deploy, OS isolation, and templates — multi-runtime (Node/PHP/static/…).

**Non-goals:** Multi-tenant reseller hierarchy; project UI does not publish Apache (use `/apache`).

## Panel

| Item | Value |
|------|--------|
| Routes | `/projects`, `/projects/:id` |
| Nav key | `projects` |
| Main actions | List · create · deploy · stop · health · git · isolation · templates |
| Capability | Projects |
| RBAC | Project operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| List / get | `ysk-server projects list\|get` | read | |
| Create | `ysk-server projects create …` | write-panel | `--create-dns` / `--create-mail` match panel checkboxes (draft only) |
| Deploy / stop / health | `ysk-server projects deploy\|stop\|health` | write-host | deploy needs execute |
| Git deploy | `ysk-server projects git-deploy --id UUID [--git-url URL] [--branch|--ref B]` | write-host | First clone is shallow (depth 1). Create stores `--git-url` / `--branch`; it does not clone. |
| Git control | `ysk-server projects git status\|log\|diff\|refs\|fetch\|checkout\|reset --id UUID` | read / write-host | Status/log/diff/refs are read-only. Panel branch is a select from `git ls-remote`. Dirty trees block pull and offer a diff. Git runs with `safe.directory` so root can read a project-owned tree. `.env` is restored after sync. |
| Git auth | `ysk-server projects git auth --id UUID --token T \| --deploy-key \| --pin-host` | write-panel | HTTPS token encrypted at rest. SSH deploy key + pinned known_hosts. No OAuth. Token never in the remote URL. |
| Git hook | `ysk-server projects git hook --id UUID --enable\|--rotate\|--disable` | write-panel | Inbound `POST /api/v1/hooks/git/:id`. Operator pastes URL + secret into GitHub/Gitea/GitLab (push). Not Slack. |
| Isolation | `ysk-server projects isolation …` | write-host | |
| Templates | `ysk-server templates list\|apply` | write-panel | |
| Project FTP (jailed) | `ysk-server projects ftp --id UUID --password P` | write-panel | Draft; apply on `/ftp` |

## CLI quick start

```bash
ysk-server projects list --json
ysk-server projects create --name demo --domain demo.example.com --runtime node --create-dns --create-mail --json
export YSK_EXECUTE=1
ysk-server projects deploy --id UUID --execute --json
```

## Honesty

- Deploy without EXECUTE is plan-only.  
- Systemd unit enable often needs root.  
- Deployed ≠ publicly published until nginx/ssl apply.  
- The inbound Git hook answers without a panel session, but clone/deploy still needs `YSK_EXECUTE=1` on the host unit.

## Inbound Git hook

Operator-pasted webhook. Not Slack. Not OAuth. YSK Server does not create the remote hook for you.

1. Project **App** tab → Git → **Enable** the push hook → copy the URL (and the one-time secret). Platform steps are folded under **How to paste this**.
2. On **GitHub** / **Gitea** / **GitLab**, add a webhook yourself:
   - Payload URL: `https://<panel-host>:9287/api/v1/hooks/git/<project-uuid>`
   - Content type: `application/json`
   - Secret: the one-time value (GitHub / Gitea HMAC, GitLab secret token, or header `X-YSK-Git-Hook`)
   - Events: **push** only
3. GitHub.com requires HTTPS. A Gitea or GitLab on the same network may use HTTP.
4. Only the project’s stored ref is synced. Pushes to other branches return `{ ok: true, skipped: "ref" }`.
5. Disable keeps the stored secret and stops sync. Rotate issues a new secret (shown once).

Test:

```bash
curl -X POST -H 'X-YSK-Git-Hook: SECRET' https://host:9287/api/v1/hooks/git/UUID
```

CLI: `ysk-server projects git hook --id UUID --enable|--rotate|--disable`  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| — | None required |

## Related

- [Runtimes](./runtimes.md) · [Nginx](./dns-ssl-nginx.md) · [CLI reference](../cli/reference.md)  
