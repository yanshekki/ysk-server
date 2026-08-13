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
| Git deploy | `ysk-server projects git-deploy …` | write-host | |
| Isolation | `ysk-server projects isolation …` | write-host | |
| Templates | `ysk-server templates list\|apply` | write-panel | |

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

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| — | None required |

## Related

- [Runtimes](./runtimes.md) · [Nginx](./dns-ssl-nginx.md) · [CLI reference](../cli/reference.md)  
