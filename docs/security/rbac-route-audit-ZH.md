# RBAC 路由審計

> 語言：中文（香港書面語）| [English](./rbac-route-audit.md)

## 用途

變更類 `/api/v1/*` 路由對應 capability；未匹配則 fail-closed。

## CLI

```bash
ysk-server rbac list
ysk-server rbac show --role operator
ysk-server rbac audit
```

公開前綴（login、部分 agent heartbeat 等）可略過 cap 檢查，但仍有 handler 內認證。

詳見英文版規則表與 [../features/users-rbac-ZH.md](../features/users-rbac-ZH.md)。
