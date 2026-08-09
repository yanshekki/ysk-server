# system-controller.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

God-file split of `apps/server/src/controllers/system-controller.ts` (~2.9k → domain modules).

## Moved out

| Domain | Module | Wave |
|--------|--------|------|
| Defense Center / protection / geoip | `routes/defense.ts` | **C1** |

## Still residual in system-controller

- real-ip / host IPs
- system email/ssl/php apply
- software catalog + stack install
- DB engines / redis browser / SQL switch
- FTPS
- firewall / fail2ban
- host identity / panel-tls / power
- nginx / systemd / services / export / migrate / readiness

## Dispatch note

`handleDefenseRoutes` runs **before** `handleSystemRoutes` in `http-server.ts` (C1).
