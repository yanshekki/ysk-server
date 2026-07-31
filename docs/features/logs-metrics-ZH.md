# 日誌與指標

> 語言：中文（香港書面語）| [English](./logs-metrics.md)

**面板路由：** `/logs`、`/metrics`、主機總覽  
**CLI：** `logs`、`host`、`health`

## 日誌中心

來源：journal unit、`/var/log` allowlist 檔、專案日誌。可用 lines／grep／since／priority 查詢；面板可選 SSE 跟隨。

```bash
ysk-server logs sources --json
ysk-server logs query --source journal:nginx.service --lines 100 --json
ysk-server logs query --source file:auth --grep Failed --lines 50 --json
ysk-server logs journal --unit ssh.service --json
ysk-server logs overview --json
```

## 指標／主機

```bash
ysk-server host overview --json
ysk-server host metrics --json
ysk-server host network --json
ysk-server health --json
ysk-server health --url http://127.0.0.1:9287/health
```

## 誠實邊界

唯讀探測通常不需 EXECUTE。Journal vacuum／logrotate 類操作可能需 root+EXECUTE，否則 blocked。

## 相關

[system-host-ZH.md](./system-host-ZH.md) · [../cli/reference-ZH.md](../cli/reference-ZH.md)
