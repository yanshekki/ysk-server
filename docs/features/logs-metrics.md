# Logs & metrics

> Language: English | [中文](./logs-metrics-ZH.md)

**Panel routes:** `/logs`, `/metrics`, host overview  
**CLI:** `logs`, `host`, `health`

## Log Center

Sources: journal units, allowlisted files under `/var/log`, project logs. Query with lines/grep/since/priority; optional SSE follow in UI.

```bash
ysk-server logs sources --json
ysk-server logs query --source journal:nginx.service --lines 100 --json
ysk-server logs query --source file:auth --grep Failed --lines 50 --json
ysk-server logs journal --unit ssh.service --json
ysk-server logs overview --json
```

## Metrics / host

```bash
ysk-server host overview --json
ysk-server host metrics --json
ysk-server host network --json
ysk-server health --json
ysk-server health --url http://127.0.0.1:9287/health
```

## Honesty

Read-only probes should not require EXECUTE. Journal vacuum / logrotate style ops in UI may need root+EXECUTE and stay blocked otherwise.

## Related

[system-host.md](./system-host.md) · [../cli/reference.md](../cli/reference.md)
