# hosting.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| PM2 + process fleet / SSE | `routes/hosting-processes.ts` | **G1** |
| Runtimes / PHP / addons / plugins / tuning | `routes/hosting-runtimes.ts` | **G2** |
| Hosting infra dispatcher | `routes/hosting-infra.ts` | **G3** / **O2** |
| DNS / PowerDNS / Cloudflare | `routes/hosting-infra-dns.ts` | **O2** |
| Nginx / firewall / files / DB provision | `routes/hosting-infra-services.ts` | **O2** |

`routes/hosting.ts` thin dispatcher: `processes → runtimes → infra`.  
`routes/hosting-infra.ts` thin dispatcher: `dns → services`.
