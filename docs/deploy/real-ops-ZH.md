# 真實套用與降級

> 語言：中文（香港書面語）| [English](./real-ops.md)

## 模式

| 模式 | 何時 | 行為 |
|------|------|------|
| 降級 | 非 root 或無 EXECUTE | 管理 dataDir；拒絕假 applied |
| 可生產 | root + EXECUTE + 關鍵二進位 | readiness 可能通過 |

降級是**設計**。

```bash
ysk-server readiness --json
ysk-server host overview --json
```

## 相關

[root-execute-ZH.md](./root-execute-ZH.md) · [../getting-started/readiness-ZH.md](../getting-started/readiness-ZH.md)
