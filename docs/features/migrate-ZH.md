# 整機遷移

> 語言：中文 | [English](./migrate.md)

**面板／CLI：** 遷移介面 · `ysk-server migrate`

## 功能

分**階段**搬運控制平面與站點狀態。每階段回傳誠實 JSON，不會靜默半套用。

| 階段 | 用途 |
|------|------|
| `inventory` | 快照專案、套件、路徑、版本 |
| `host` | 在目標機傳輸／套用（按需 EXECUTE／root） |
| `post` | 後置檢查、DNS／SSL 提醒 |
| `status`／`resume` | 中斷後檢視或繼續 |

## CLI

```bash
ysk-server migrate inventory --json
ysk-server migrate host --json          # 先看計劃；就緒再 --execute
ysk-server migrate post --json
ysk-server migrate status --json
ysk-server migrate resume --json
```

## 操作員清單

1. 來源機先 `backup control-plane` + 專案備份。  
2. 跑 `inventory` 並保存 JSON。  
3. 目標機：相近產品版本、磁碟、`YSK_EXECUTE`。  
4. `host` 先 dry-run，再 `--execute`。  
5. 目標機 `post` + `readiness`。  
6. health 正常後才切 DNS。  

## 誠實邊界

- 階段中途 fail-closed：用 `status`／`resume`，勿假設成功。  
- OS 用戶／nginx／郵件在目標機仍需 root+EXECUTE。  

## 相關

[../cli/reference-ZH.md](../cli/reference-ZH.md) · [../deploy/host-migrate-ZH.md](../deploy/host-migrate-ZH.md) · [projects-ZH.md](./projects-ZH.md)
