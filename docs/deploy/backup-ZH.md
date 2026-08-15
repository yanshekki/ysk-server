# 備份操作

> 語言：中文 | [English](./backup.md)

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

SFTP 測試／推送使用出站身分。遠端目錄會 `mkdir -p`。若有專案 SQL sidecar，會複製到 tar 旁邊。控制平面預覽是 `tar -tzf`（不需專案列）。
