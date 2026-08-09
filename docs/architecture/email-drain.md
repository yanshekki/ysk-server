# email.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Domains dispatcher | `routes/email-domains.ts` | **I1** / **P3** |
| Domains list/create/delete | `routes/email-domains-crud.ts` | **P3** |
| Mailboxes / aliases / deliverability / DNS | `routes/email-domains-ops.ts` | **P3** |
| Webmail / sieve / SSO | `routes/email-webmail.ts` | **I2** |
| Relay / queue / bootstrap / mail-tls / dnsbl / warmup | `routes/email-ops.ts` | **I3** |

`routes/email.ts` thin dispatcher: `domains → webmail → ops`.  
`routes/email-domains.ts` thin dispatcher: `crud → ops`.
