# 生產就緒

> 語言：中文 | [English](./readiness.md)

```bash
ysk-server readiness --data-dir … --json
ysk-server doctor --json   # 別名
```

HTTP readiness 在未達標時可回 503，但仍附完整報告（不是假成功）。

殘留主機檔（Apache 預設站、缺 nginx catch-all、vsftpd 失敗、Dovecot TLS 指向不存在的憑證、過期 `~/.npm-global` CLI）顯示為 **degraded**，不會自動修好。Overlay 不會改寫那些檔案。CLI：`ysk-server hosting leftovers`。

面板：`/system/readiness`。
