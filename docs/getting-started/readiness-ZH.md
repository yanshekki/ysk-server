# 生產就緒

> 語言：中文 | [English](./readiness.md)

```bash
ysk-server readiness --data-dir … --json
ysk-server doctor --json   # 別名
```

HTTP readiness 在未達標時可回 503，但仍附完整報告（不是假成功）。

面板：`/system/readiness`。
