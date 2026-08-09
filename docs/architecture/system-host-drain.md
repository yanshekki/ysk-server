# system-host.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Real-IP / host IPs / FTPS | `routes/system-host-net.ts` | **M3** |
| Host overview / hostname / timezone | `routes/system-host-identity-core.ts` | **R3** |
| Panel TLS + NTP / power | `routes/system-host-panel.ts` | **R3** |
| Identity dispatcher | `routes/system-host-identity.ts` | **R3** |

`routes/system-host.ts` thin dispatcher: `net → identity(core → panel)`.
