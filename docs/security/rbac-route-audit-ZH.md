# RBAC 路由審計

> 語言：中文 | [English](./rbac-route-audit.md)

## 用途

變更類 `/api/v1/*` 路由對應 capability。未匹配則 fail-closed。

## 公開／略過前綴

登入、登出、部分自助認證、有限 agent poller 路徑可略過 cap 檢查，但仍在 handler 內認證。

## CLI

```bash
ysk-server rbac list --json
ysk-server rbac show --role operator --json
ysk-server rbac audit --json
```

## 抽樣矩陣

| 方法 | 路徑模式 | 能力（例） |
|------|----------|------------|
| POST/PATCH/DELETE | `/api/v1/users` | `users.manage` |
| POST | `/api/v1/users/:id/impersonate` | `users.impersonate` |
| DELETE | `/api/v1/projects/:id` | 專案刪除能力 |
| POST | `/api/v1/tools/execute` | 工具執行能力 |

精確規則在 `ysk-server-shared` 的 `route-capabilities` 與 server `rbac-guard`。

## 相關

[../features/users-rbac-ZH.md](../features/users-rbac-ZH.md) · [overview-ZH.md](./overview-ZH.md)
