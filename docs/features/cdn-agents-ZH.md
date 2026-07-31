# CDN 與 Fleet Agent

> 語言：中文 | [English](./cdn-agents.md)

**面板：** CDN 頁 · `/agents`  
**CLI：** `cdn`、`agents`、`agent run`

## CDN

節點與站點：upsert、render conf、apply／purge、DNS 同步輔助、health 迴圈。

```bash
ysk-server cdn nodes list --json
ysk-server cdn nodes upsert --name edge1 --base-url https://edge.example.com --json
ysk-server cdn sites list --json
ysk-server cdn render --site-id ID --json
ysk-server cdn apply --site-id ID --execute --json
ysk-server cdn purge --site-id ID --json
ysk-server cdn from-project --project-id UUID --json
```

## Fleet agent

| 概念 | 含義 |
|------|------|
| 註冊 | 控制平面 session 列 |
| 已連線 | 近期有 heartbeat |
| 命令 | 給邊緣 poller 的佇列 |
| `agent run` | 外送 poller 行程 |

```bash
ysk-server agents fleet list --json
ysk-server agents fleet register --id edge-1 --json
ysk-server agents fleet commands --session SESSION --json
ysk-server agent run --control-plane http://CP:9287 --id edge-1
```

## 誠實邊界

**已註冊 ≠ 已連線。** 已入佇列 ≠ 邊緣已套用。入隊需認證；僅有限 poller 路徑公開。面板實驗性 — 優先 CLI／API。

## 相關

[../deploy/cdn-fleet-ZH.md](../deploy/cdn-fleet-ZH.md) · [../cli/reference-ZH.md](../cli/reference-ZH.md)
