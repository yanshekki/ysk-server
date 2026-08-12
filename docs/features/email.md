# Email

> Language: English | [中文](./email-ZH.md)

## Purpose

Operate **mail domains and mailboxes** on the host (Postfix/Dovecot stack paths), DNS bundles, deliverability probes, aliases, queue, and optional SMTP relay.

**Non-goals:** Guaranteed global inbox delivery; PTR and Port 25 are external.

## Panel

| Item | Value |
|------|--------|
| Routes | `/email`, domain detail |
| Nav key | `email` |
| Main actions | Domains · mailboxes · DNS · deliverability · aliases · queue · relay · webmail |
| Capability | Email |
| RBAC | Mail operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Domains list/create/get | `ysk-server email domains …` | write-panel | |
| Mailboxes list/create | `ysk-server email mailboxes …` | write-panel / write-host | system user optional |
| DNS bundle | `ysk-server email dns --domain …` | read | |
| Deliverability | `ysk-server email deliverability --domain …` | read | honest score |
| Bootstrap stack | `ysk-server email bootstrap … [--install]` | write-host | |
| Aliases CRUD | `ysk-server email aliases list\|create\|delete` | write-panel | |
| Queue list/flush | `ysk-server email queue list\|flush --execute` | write-host | flush |
| Relay get/apply | `ysk-server email relay get\|apply --host …` | write-host | applySystem with execute |

## CLI quick start

```bash
ysk-server email domains list --json
ysk-server email deliverability --domain example.com --json
ysk-server email aliases list --domain example.com --json
ysk-server email queue list --json
ysk-server email relay get --json
```

## Honesty

- Deliverability never claims global inbox success.  
- PTR / Port 25 / blacklists require external action.  
- Queue flush and system mail packages need EXECUTE.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Webmail UI / SSO browser flow | Interactive; bootstrap via CLI |

## Related

- [Email deliverability](../email/deliverability.md)  
- [CLI reference — email](../cli/reference.md)  
