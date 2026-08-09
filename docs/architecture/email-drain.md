# email.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Domains dispatcher | `routes/email-domains.ts` | **I1** / **P3** |
| Domains list/create/delete | `routes/email-domains-crud.ts` | **P3** |
| Deliverability / DNS / checks / policy / warmup | `routes/email-domains-deliverability.ts` | **S2** |
| Mailboxes / aliases / dovecot passdb | `routes/email-domains-mailboxes.ts` | **S2** |
| Ops dispatcher | `routes/email-domains-ops.ts` | **S2** |
| Webmail apply / project create | `routes/email-webmail-apply.ts` | **W1** |
| Webmail SSO / sieve / SSO plugin | `routes/email-webmail-sso.ts` | **W1** |
| Webmail dispatcher | `routes/email-webmail.ts` | **W1** |
| Relay / queue / bootstrap / mail-tls / dnsbl / warmup | `routes/email-ops.ts` | **I3** |

`routes/email.ts` thin dispatcher: `domains → webmail(apply → sso) → ops`.  
`routes/email-domains.ts` thin dispatcher: `crud → ops(deliverability → mailboxes)`.
