# defense.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| Defense Center + protection probe/emergency | `routes/defense-center.ts` | **M2** |
| GeoIP / IP access policy | `routes/defense-geoip.ts` | **M2** |

`routes/defense.ts` thin dispatcher: `center → geoip`.
