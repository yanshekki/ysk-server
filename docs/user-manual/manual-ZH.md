# 操作員手冊

> 語言：中文（香港書面語）| [English](./manual.md)

單機生產主機的 Day-1…N 路徑。完整地圖：[../INDEX-ZH.md](../INDEX-ZH.md)。  
文件標準：[../docs-standard-ZH.md](../docs-standard-ZH.md)。

## 1. 安裝與初始化

```bash
pnpm install && pnpm build
ysk-server setup --data-dir /var/lib/ysk-server --admin-user admin --admin-password 'StrongPass!' --locale zh-HK --json
ysk-server serve --data-dir /var/lib/ysk-server
```

見 [../getting-started/install-ZH.md](../getting-started/install-ZH.md) · [setup-ZH.md](../getting-started/setup-ZH.md)。

## 2. 加固面板

1. 登入 → 若 bootstrap 密碼偏弱請立即更改（`mustChangePassword` 會在 `/login` 顯示改密表單）。  
2. 開啟**面板 2FA**（帳號安全）。  
3. 建議監聽 `127.0.0.1` + 反向代理／SSH tunnel。  
4. 可選：`security.require_admin_totp`。  

CLI：`ysk-server security status --json`。  
手冊：[../features/security-auth-ZH.md](../features/security-auth-ZH.md)。

## 3. 第一個站點

```bash
export YSK_EXECUTE=1   # systemd／nginx 通常需 root
ysk-server projects create --name demo --domain demo.example.com --runtime node --create-dns --create-mail --json
ysk-server projects deploy --id <UUID> --execute --json
ysk-server nginx sync --execute --json
```

詳見：[../features/projects-ZH.md](../features/projects-ZH.md)。

## 4. DNS／SSL／Nginx

```bash
ysk-server dns zones --json
ysk-server ssl list --json
ysk-server nginx status --json
```

於 DNS 供應商發布 A／AAAA。  
空白或非法的 Nginx `server_name` 會被拒絕（不會退回 `localhost`）。  
[../features/dns-ssl-nginx-ZH.md](../features/dns-ssl-nginx-ZH.md)

## 5. 可選郵件

```bash
ysk-server email bootstrap --domain example.com --ip YOUR_IP --json
ysk-server email deliverability --domain example.com --json
ysk-server email aliases list --domain example.com --json
```

**PTR** 與 **Port 25**（或中繼）必須由你在外部完成。  
[../features/email-ZH.md](../features/email-ZH.md)

## 6. 資料庫與 Redis

```bash
ysk-server db status --json
ysk-server redis status --json
ysk-server db sql-engine preview --target mariadb --json
```

[../features/databases-ZH.md](../features/databases-ZH.md)

## 7. VPN／VNC（可選）

```bash
ysk-server vpn status --json
ysk-server vnc status --json
# 主機變更需 YSK_EXECUTE=1 + --execute
```

[../features/vpn-ZH.md](../features/vpn-ZH.md) · [../features/vnc-ZH.md](../features/vnc-ZH.md)

## 8. 網絡暴露、Real-IP、面板 TLS

```bash
ysk-server network exposure list --json
ysk-server real-ip status --json
ysk-server ssl panel-tls status --json
```

[../features/system-host-ZH.md](../features/system-host-ZH.md)

## 9. 更新與軟件

```bash
ysk-server updates inventory --json
ysk-server software list --json
ysk-server update --check --json
```

## 10. 防護與備份

```bash
ysk-server defense status --json
ysk-server backup schedule --install --execute
ysk-server readiness --json
```

## 11. 日常運維

| 任務 | 命令／介面 |
|------|------------|
| 就緒 | `readiness --json`／系統 → 就緒 |
| 日誌 | `logs query …`／日誌中心 |
| 主機套件 | `updates inventory` |
| 產品本體更新 | `update --apply` 或 `install.sh --upgrade` |
| 工作階段／金鑰 | `security sessions` · `security api-keys` |
| FTP | `ftp accounts list` |
| 執行環境 | `runtimes list` |

## 安全提醒

- 主機變更預設試跑。  
- 已寫入 ≠ 已套用。  
- 無 EXECUTE／root 時 fail-closed 屬正常。  
- 僅面板介面：終端 PTY、VNC 畫布、Host Browse、檔案預覽。  

完整 CLI：[../cli/reference-ZH.md](../cli/reference-ZH.md)。  
對等：[../cli/panel-parity-matrix-ZH.md](../cli/panel-parity-matrix-ZH.md)。
