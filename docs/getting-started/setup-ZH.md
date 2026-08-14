# 首次初始化

> 語言：中文 | [English](./setup.md)

```bash
ysk-server setup --data-dir /var/lib/ysk-server --admin-user admin --admin-password 'StrongPass!' --locale zh-HK --json
ysk-server serve --data-dir /var/lib/ysk-server
```

會建立 `config.json`、document store、管理員、dataDir 內 systemd unit 範本。

請使用強密碼。僅本機開發才可設 `YSK_ALLOW_INSECURE_DEFAULTS=1`。

## 下一步

[readiness-ZH.md](./readiness-ZH.md) · [../deploy/systemd-ZH.md](../deploy/systemd-ZH.md)
