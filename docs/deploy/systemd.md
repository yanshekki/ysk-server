# systemd 部署（YSK Server）

## 由控制平面生成 unit

```bash
# 寫入 dataDir/systemd/ysk-server.service
curl -X POST http://127.0.0.1:8787/api/v1/system/systemd/install \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"enable":false}'
```

有 root 且 `YSK_EXECUTE=1` 時可 `"enable":true` 自動 `cp` + `systemctl enable --now`。

## 手動安裝

```bash
sudo cp deploy/ysk-server.service /etc/systemd/system/
# 按實際路徑修改 ExecStart / WorkingDirectory
sudo systemctl daemon-reload
sudo systemctl enable --now ysk-server
sudo systemctl status ysk-server
```

## 環境變數

| 變數 | 作用 |
|------|------|
| `YSK_EXECUTE=1` | 允許突變系統（apt、useradd、ufw、certbot…） |
| `YSK_PROBE_ON_START=1` | 啟動時立即跑 protection probe |
| `YSK_DISABLE_SCHEDULER=1` | 關閉內建排程（測試用） |
| `YSK_LLM_BASE_URL` | OpenAI-compatible API |
| `YSK_ADMIN_PASSWORD` | setup 時 admin 密碼 |

## 安全建議

- 預設只 bind `127.0.0.1`，外網經 Nginx TLS 反代
- 生產務必改 admin 密碼並限制 `YSK_EXECUTE`
