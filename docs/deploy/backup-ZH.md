# 備份操作

> 語言：中文（香港書面語）| [English](./backup.md)

## 日常命令

```bash
ysk-server backup list --json
ysk-server backup status --json
ysk-server backup all --json
ysk-server backup control-plane --json
ysk-server backup schedule --install --execute
```

功能詳解：[../features/backups-cron-ZH.md](../features/backups-cron-ZH.md)。

## 誠實邊界

安裝排程需 EXECUTE。dataDir 封存 ≠ 異地成功，直至遠端／restic 確認。
