# 用戶、方案、RBAC

> 語言：中文 | [English](./users-rbac.md)

**面板路由：** `/users`  
**CLI：** `users`、`packages`、`rbac`

## 用戶與方案

| 概念 | 含義 |
|------|------|
| 用戶 | 面板操作員（admin／operator／viewer…） |
| 方案 | 配額範本（多為**主機範圍**總量） |
| 覆寫 | 每用戶 capability 授予／撤銷 |

```bash
ysk-server users list --role admin --json
ysk-server users create --username ops --password '…' --role operator --json
ysk-server packages list --json
```

## RBAC

角色 factory 政策 + 有效 capability。變更 API 路由對應 capability（fail-closed）。

```bash
ysk-server rbac list --json
ysk-server rbac show --role operator --json
ysk-server rbac audit --json
```

## 誠實邊界

admin 系統角色不能被髒政策剝光關鍵特權。方案配額不是完整多租戶隔離。

## 相關

[security-auth-ZH.md](./security-auth-ZH.md) · [../security/rbac-route-audit-ZH.md](../security/rbac-route-audit-ZH.md)
