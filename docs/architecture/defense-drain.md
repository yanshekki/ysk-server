# defense.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Defense Center dispatcher | `routes/defense-center.ts` | **M2** / **O1** |
| Protection set/probe/status/emergency | `routes/defense-protection.ts` | **O1** |
| Defense ops dispatcher | `routes/defense-ops.ts` | **O1** / **P2** |
| Ban / unban / preset / stack / timeline | `routes/defense-ban.ts` | **P2** |
| Auto-ban / automation / intel / cloudflare | `routes/defense-automation.ts` | **P2** |
| GeoIP / IP access policy | `routes/defense-geoip.ts` | **M2** |

`routes/defense.ts` thin dispatcher: `center → geoip`.  
`routes/defense-center.ts` thin dispatcher: `protection → ops`.  
`routes/defense-ops.ts` thin dispatcher: `ban → automation`.
