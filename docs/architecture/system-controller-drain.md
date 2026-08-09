# system-controller.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

God-file split of `apps/server/src/controllers/system-controller.ts` (~2.9k → domain modules).

## Moved out

| Domain | Module | Wave |
|--------|--------|------|
| Defense Center / protection / geoip | `routes/defense.ts` | **C1** |
| Firewall + Fail2ban | `routes/firewall.ts` | **C2** |
| Software catalog + stack install | `routes/software.ts` | **C3** |

## Still residual in system-controller

- real-ip / host IPs
- system email/ssl/php apply
- DB engines / redis browser / SQL switch
- FTPS
- host identity / panel-tls / power
- nginx / systemd / services / export / migrate / readiness

## Dispatch note

`handleDefenseRoutes`, `handleFirewallRoutes`, and `handleSoftwareRoutes` run **before** `handleSystemRoutes` in `http-server.ts`.
