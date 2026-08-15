# CDN + Fleet 誠實閉環（D3）

> 語言：中文 | [English](./cdn-fleet.md)

> 本頁為對應英文運維文件的香港書面語版；命令與路徑保持原文以便複製。

單控制平面 → 多 edge 的 **config fan-out** 與 **fleet agent 隊列**。  
硬規則：**queued / written ≠ nginx applied**；edge 真正套用必須有 agent ack 或 root+`YSK_EXECUTE` 本機/SSH reload。

## 能力矩陣

| 能力 | Panel / API | CLI | 誠實條件 |
|------|-------------|-----|----------|
| 節點 registry | `/api/v1/cdn/nodes` | `cdn nodes list\|upsert\|delete\|probe\|drain` | fleet 節點可只綁 `fleetAgentId` |
| Site + origin | `/api/v1/cdn/sites` | `cdn sites list\|get\|upsert\|delete` | origin = project \| url |
| Edge conf render | `…/sites/:id/render` | `cdn render --site-id` | 寫 `dataDir/cdn/sites/<id>/edge.conf` |
| Fan-out apply | `…/sites/:id/apply` | `cdn apply --site-id` | local written / fleet queued / SSH applied |
| Purge | `…/sites/:id/purge` | `cdn purge` | 同上 |
| DNS sync | `…/sites/:id/dns-sync` | `cdn dns-sync` | 健康 edge → RRset |
| Health loop | `POST /cdn/health-loop` | `cdn health-loop` | 週期探活 |
| Dashboard | `GET /cdn/dashboard` | `cdn dashboard` | 讀取聚合 |
| From project | `POST /cdn/from-project` | `cdn from-project` | 一鍵綁 project origin |
| Fleet agents | `/api/v1/fleet/agents` | `agents fleet list\|register\|commands` | register ≠ connected |
| Edge poller | — | `agent run --control-plane URL --id EDGE` | 執行 `cdn.edge.apply/purge` 後 ack |

## apply_status 含義

| 值 | 意思 |
|----|------|
| `applied` | 每 edge nginx -t + reload 成功（本機或 SSH） |
| `written` | conf 已寫 dataDir／fleet command **queued**；**未**聲稱 edge 已 reload |
| `partial` | 部分 edge applied |
| `blocked` | 需要 EXECUTE 的路徑被擋（例如純 SSH 且無 EXECUTE） |
| `failed` | 硬失敗 |

## CLI 快速路徑

```bash
# 1) 登記 fleet session（panel/cli 僅 registered，未 live）
ysk-server agents fleet register --id edge-tokyo --json
# → agent.id = SESSION

# 2) 綁 CDN node
ysk-server cdn nodes upsert --name tokyo --fleet-agent-id SESSION --json

# 3) Site
ysk-server cdn sites upsert --name app \
  --domains app.example.com --edge-id NODE_ID \
  --origin-url https://origin.example.com --json

# 4) Fan-out（無 YSK_EXECUTE 亦可：written + queue）
ysk-server cdn apply --site-id SITE --json
# apply_status=written · edges[].method=fleet

# 5) 查隊列（仍為 queued）
ysk-server agents fleet commands --session SESSION --json

# 6) Edge 機上跑 poller（真正寫 conf + nginx）
YSK_EXECUTE=1 ysk-server agent run \
  --control-plane http://cp:9287 --id edge-tokyo --data-dir /var/lib/ysk
```

## 本地 edge（無 SSH）

```bash
ysk-server cdn nodes upsert --name local --ipv4 127.0.0.1
ysk-server cdn apply --site-id SITE
# 無 EXECUTE → conf 寫入 dataDir/nginx/conf.d（written）
# 有 EXECUTE + nginx → applied
```

## E2E

```bash
pnpm e2e:real-ops
# 含：fleet register → node/site → apply written + commands queued
#     local node apply written
```

## 刻意範圍外

- 自動多 CDN 商（Akamai 等）  
- 全網 Anycast 任播  
- 無 agent 時假標 `applied`  
- 虛構 `root@publicIpv4` SSH；遠端 edge 使用 loopback origin 而不改寫／拒絕  

見 [dns-cdn-design.md](../product/dns-cdn-design.md) · [panel-parity-matrix](../cli/panel-parity-matrix.md)。

## E2E（queue → ack）

```bash
pnpm e2e:real-ops
# 內含 scripts/e2e-cdn-fleet-ack.mjs：register → apply queue → agentCycle → conf write → status=done
```

Fleet **heartbeat / ack** 為 public mutating（無 panel token）；**enqueue command** 仍需 Bearer。
