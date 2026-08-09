# hosting.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| PM2 + process fleet / SSE | `routes/hosting-processes.ts` | **G1** |
| Runtimes / PHP / addons / plugins / tuning | `routes/hosting-runtimes.ts` | **G2** |
| Hosting infra dispatcher | `routes/hosting-infra.ts` | **G3** / **O2** |
| DNS zone plan/files + Cloudflare | `routes/hosting-dns-zones.ts` | **Z1** |
| PowerDNS install / heal / load | `routes/hosting-dns-powerdns.ts` | **Z1** |
| DNS dispatcher | `routes/hosting-infra-dns.ts` | **Z1** |
| Nginx / firewall / files / DB provision | `routes/hosting-infra-services.ts` | **O2** |

`routes/hosting.ts` thin dispatcher: `processes → runtimes → infra`.  
`routes/hosting-infra.ts` thin dispatcher: `dns(zones → powerdns) → services`.
