# 系統級 apply（root + YSK_EXECUTE）

> 語言：中文 | [English](./root-apply.md)

> 本頁為對應英文運維文件的香港書面語版；命令與路徑保持原文以便複製。

YSK Server **預設 fail-closed**：只在 `dataDir` 寫配置。要真改系統需：

```bash
export YSK_EXECUTE=1
# 以 root 啟動 serve，或 systemd User=root
ysk-server serve --config /var/lib/ysk-server/config.json
```

## 一鍵 demo（安全預設：只寫 dataDir）

```bash
# 先開 control plane
ysk-server serve --config .ysk/config.json

# 另一 terminal
chmod +x scripts/demo-system-apply.sh
./scripts/demo-system-apply.sh
```

## 真套用（危險 — 需 root）

```bash
# server 進程環境
export YSK_EXECUTE=1
# demo 腳本請求 install/apply
APPLY_SYSTEM=1 ./scripts/demo-system-apply.sh
```

## 對應 API

見 [API overview](../api/overview.md)「System-level apply」。

| 操作 | 無 root | 有 root + EXECUTE |
|------|---------|-------------------|
| email apply | 寫 postfix/dovecot 模板 | 可 apt install + cp config |
| ssl apply | 回傳 certbot 命令 | 可 certbot --nginx |
| firewall apply | 列 ufw 命令 | 可執行 ufw/fail2ban |
| systemd install | 寫 unit 到 dataDir | enable --now ysk-server |

## 建議生產流程

1. 非 root 先 `demo-system-apply.sh` 生成配置  
2. 人工 review `.ysk/email`、`.ysk/nginx`、`.ysk/systemd`  
3. 維護窗口設 `YSK_EXECUTE=1` 再 enable apply  
4. 完成後關閉 EXECUTE
