# 用戶、方案與 RBAC

> 語言：中文（香港書面語）| [English](./users-rbac.md)

## 用途

控制平面 **用戶**、**方案（packages）** 與 **RBAC** 政策檢視。

**非目標：** 完整多租戶 Reseller 樹（產品以管理員優先）。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/users` |
| 導航鍵 | `users` |
| 主要操作 | 用戶 CRUD · 方案 · 角色矩陣 |
| 能力 | 管理用戶／方案／rbac |
| RBAC | 管理員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 用戶列表／建立 | `ysk-server users list\|create …` | write-panel | `--totp 0\|1` |
| 用戶 2FA 狀態／清除 | `ysk-server users totp\|totp-clear --user NAME` | write-panel | 清除需 `--confirm-username` |
| 方案列表 | `ysk-server packages list` | read | |
| RBAC 列表／顯示／審計 | `ysk-server rbac list\|show\|audit` | read | |

## CLI 速查

```bash
ysk-server users list --json
ysk-server packages list --json
ysk-server rbac list --json
```

## 誠實邊界

- 面板 packages 為控制平面方案，不是 apt 套件（見 `updates`／`software`）。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| — | 無 |

## 相關

- [安全認證](./security-auth-ZH.md)  
