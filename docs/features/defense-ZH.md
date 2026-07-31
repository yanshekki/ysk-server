# 防護中心

> 語言：中文（香港書面語）| [English](./defense.md)

**面板路由：** `/protection`、`/firewall`、`/fail2ban`  
**CLI：** `defense`／`protection`

## 功能

統一主機防護：UFW 腳本、fail2ban jail、ban／unban／白名單、檔位、時間線、可選 Cloudflare 輔助。

## CLI

```bash
ysk-server defense status --json
ysk-server defense firewall --json
ysk-server defense fail2ban --json
ysk-server defense ban --ip 1.2.3.4 --json          # 預設 dry-run
ysk-server defense ban --ip 1.2.3.4 --execute --json
ysk-server defense presets --json
ysk-server defense timeline --json
ysk-server defense stack-apply --execute --json
```

## 誠實邊界

無 `YSK_EXECUTE=1`（常需 root）時動作會 **blocked** 或只寫 dataDir 管理檔。被擋時絕不報防火牆已上線成功。

## 相關

[../deploy/defense-ZH.md](../deploy/defense-ZH.md) · [../cli/reference-ZH.md](../cli/reference-ZH.md)
