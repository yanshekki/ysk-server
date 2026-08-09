# system-controller.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

God-file split of `apps/server/src/controllers/system-controller.ts` (~2.9k → domain modules).

## Moved out

| Domain | Module | Wave |
|--------|--------|------|
| Defense Center / protection / geoip | `routes/defense.ts` | **C1** |
| Firewall + Fail2ban | `routes/firewall.ts` | **C2** |
| Software catalog + stack install | `routes/software.ts` | **C3** |
| System DB engines / redis / dump | `routes/system-db.ts` | **D1** |
| Real-IP / FTPS / host / panel-TLS / power | `routes/system-host.ts` | **D2** |

## Still residual in system-controller

- system email/ssl/php apply
- nginx / systemd / services / updates-self
- export / managed-nginx / rebuild / migrate / readiness

## Dispatch note

Domain slices (`defense`, `firewall`, `software`, `system-db`, `system-host`) run **before** `handleSystemRoutes` in `http-server.ts`.
