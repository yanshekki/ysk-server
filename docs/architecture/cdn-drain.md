# cdn.ts drain status

Canonical workdir: `/home/ki/文件/ysk-server/`.

| Domain | Module | Wave |
|--------|--------|------|
| CDN nodes registry / probe / drain | `routes/cdn-nodes.ts` | **K3** |
| CDN sites dispatcher | `routes/cdn-sites.ts` | **K3** / **O3** |
| Sites CRUD / dashboard / health-loop | `routes/cdn-sites-crud.ts` | **O3** |
| Site edge render/apply/purge/dns | `routes/cdn-sites-edge-ops.ts` | **AB2** |
| Site SSL distribute/issue/acme | `routes/cdn-sites-ssl.ts` | **AB2** |
| Edge dispatcher | `routes/cdn-sites-edge.ts` | **AB2** |

`routes/cdn.ts` thin dispatcher: `nodes → sites`.  
`routes/cdn-sites.ts` thin dispatcher: `crud → edge(ops → ssl)`.
