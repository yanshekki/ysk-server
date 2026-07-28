# Real Ops Vertical — 真實應用合格線

本文件定義 **YSK Server 可真實應用** 的最小垂直路徑（非假成功）。

## 合格條件

| 步驟 | 行為 | 驗證 |
|------|------|------|
| 1. Create project | 在 `dataDir/projects/` 建立真實目錄 | `project.json` 存在 |
| 2. Deploy Node | `spawn` Node 行程、寫 pidfile、**綁定 port** | `ss`/`curl` 通 |
| 3. Health | `GET http://127.0.0.1:<port>/` 回 2xx | API `/health` 與直連 curl |
| 4. Publish Nginx | 寫入 `dataDir/nginx/conf.d/*.conf`，`proxy_pass` 指向真實 port | 檔案內容正確 |
| 5. Stop | SIGTERM/SIGKILL，port 關閉 | curl 失敗 |
| 6. Email/SSL apply | 寫配置 + **status write-back** 到 store | certificates / domain.apply_status |

系統路徑（`/etc/nginx`、systemd enable、apt install、certbot run）仍需：

```bash
export YSK_EXECUTE=1
# 且 process 為 root（或具對應 capability）
```

## API

```http
POST /api/v1/projects              # 建立
POST /api/v1/projects/:id/deploy   # 真 spawn + health
GET  /api/v1/projects/:id/health
POST /api/v1/projects/:id/publish-nginx
POST /api/v1/projects/:id/stop
POST /api/v1/system/email/apply    # 寫 dataDir + apply_status write-back
POST /api/v1/system/ssl/apply      # plan/run + certificates[] write-back
GET  /api/v1/system/ssl/certificates
```

## 一鍵 E2E

```bash
# 從 repo root
bash scripts/e2e-real-ops.sh
```

腳本會：build → `serve --data-dir <tmp>` → login → create → **deploy** → curl app → health → nginx → stop → ssl write-back。

## 本機手動

```bash
pnpm build
export YSK_ADMIN_PASSWORD=admin
node apps/server/dist/cli.js setup --data-dir .ysk --non-interactive
node apps/server/dist/cli.js serve --data-dir .ysk --port 9287

# 另一終端
TOKEN=$(curl -s -X POST http://127.0.0.1:9287/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | jq -r .token)

PID=$(curl -s -X POST http://127.0.0.1:9287/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"demo","domain":"demo.local","runtime":"node"}' | jq -r .project.id)

curl -s -X POST "http://127.0.0.1:9287/api/v1/projects/$PID/deploy" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' | jq .
```

## Web UI

登入後 **專案** 頁：建立 → **Deploy Node** → 詳情內 **Publish Nginx / Health / 停止行程**。  
狀態欄顯示 `processStatus`、`port`、`pid`。

## systemd

見 `deploy/ysk-server.service` 與 `docs/deploy/systemd.md`。  
`install.sh --from-source` 會 build 並可安裝 unit。

## 仍非完整 Spec 的部分

- Postfix 真套件安裝、多版本 PHP 矩陣、PostgreSQL 佈建  
- ≥90% 測試覆蓋率  
- 生產 CA 自動續期監控  

以上列為後續里程碑；**本文件路徑必須可在無 root 下通過 e2e**（root 路徑為可選增強）。
