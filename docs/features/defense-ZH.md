# 防護與 Protection

> 語言：中文（香港書面語）| [English](./defense.md)

## 用途

主機 **防火牆／fail2ban／防護中心** 操作；無 EXECUTE 時以誠實阻擋狀態回報。

**非目標：** 保證零入侵；地理／IP 策略仍依賴主機工具。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/protection` |
| 導航鍵 | `protection` |
| 主要操作 | 狀態 · 防火牆 · fail2ban · 封鎖／解封 · 預設 · 時間線 |
| 能力 | 防護 |
| RBAC | 安全操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 狀態／堆疊 | `ysk-server defense status --json` | read | `protection` 別名 |
| 防火牆／fail2ban 深度 | `ysk-server defense firewall\|fail2ban` | read | |
| 封鎖／解封／白名單 | `ysk-server defense ban\|unban\|… --execute` | write-host | |
| 預設／時間線 | `ysk-server defense presets\|timeline` | read | |
| 堆疊套用 | `ysk-server defense stack-apply --execute` | write-host | |

## CLI 速查

```bash
ysk-server defense status --json
ysk-server defense fail2ban --json
export YSK_EXECUTE=1
ysk-server defense ban --ip 1.2.3.4 --execute --json
```

## 誠實邊界

- 線上 UFW／fail2ban 變更需 EXECUTE + root。  
- 無工具時 fail-closed 屬正確，而非靜默成功。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| — | 無 |

## 相關

- [安全認證](./security-auth-ZH.md) · [系統主機](./system-host-ZH.md)  
