# defense.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Defense Center dispatcher | `routes/defense-center.ts` | **M2** / **O1** |
| Protection set/probe/status/emergency | `routes/defense-protection.ts` | **O1** |
| Ban / automation / intel / cloudflare | `routes/defense-ops.ts` | **O1** |
| GeoIP / IP access policy | `routes/defense-geoip.ts` | **M2** |

`routes/defense.ts` thin dispatcher: `center → geoip`.  
`routes/defense-center.ts` thin dispatcher: `protection → ops`.
