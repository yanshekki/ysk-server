# email.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Domains CRUD + per-domain mailboxes/aliases/dns/… | `routes/email-domains.ts` | **I1** |
| Webmail / sieve / SSO | `routes/email-webmail.ts` | **I2** |
| Relay / queue / bootstrap / mail-tls / dnsbl / warmup | `routes/email-ops.ts` | **I3** |

`routes/email.ts` is a **thin dispatcher**:

```
domains → webmail → ops
```

**Wave I complete.**
