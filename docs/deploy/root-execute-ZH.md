# root 與 YSK_EXECUTE

> 語言：中文（香港書面語）| [English](./root-execute.md)

**用途：** 界定控制平面何時可改真實主機。

## 規則

| 條件 | 結果 |
|------|------|
| 未設 `YSK_EXECUTE` | 主機變更 blocked 或僅 dry-run |
| 有 EXECUTE、非 root | 多項仍 blocked（useradd、系統 conf、apt） |
| root + EXECUTE | 可走完整套用路徑 |

## CLI 模式

```bash
export YSK_EXECUTE=1
ysk-server <變更命令> --json           # dry-run 計劃
ysk-server <變更命令> --execute --json # 真實嘗試
```

文件另有 `--install` 等旗標時亦須一併使用。

## 相關

[real-ops-ZH.md](./real-ops-ZH.md) · [../architecture/ops-honesty-ZH.md](../architecture/ops-honesty-ZH.md)
