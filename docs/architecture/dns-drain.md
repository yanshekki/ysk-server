# dns.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Cluster peers / push / reload / probe | `routes/dns-cluster.ts` | **X2** |
| Checklist / health / lookup / validate / DNSSEC | `routes/dns-tools.ts` | **X2** |
| DNS dispatcher | `routes/dns.ts` | **X2** |

Dispatch: `cluster → tools`.
