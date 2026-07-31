# 操作員手冊

> 語言：中文 | [English](./manual.md)

單機生產主機的 Day-1 路徑。完整地圖見 [../INDEX-ZH.md](../INDEX-ZH.md)。

## 1. 安裝與初始化

```bash
pnpm install && pnpm build
ysk-server setup --data-dir /var/lib/ysk --admin-password 'StrongPass!' --locale zh-HK --json
ysk-server serve --data-dir /var/lib/ysk
```

見 [../getting-started/install-ZH.md](../getting-started/install-ZH.md) · [setup-ZH.md](../getting-started/setup-ZH.md)。

## 2. 加固面板

1. 登入 → 若 bootstrap 密碼偏弱請立即更改。  
2. 開啟**面板 2FA**（帳號安全）。  
3. 建議監聽 `127.0.0.1` + 反向代理／SSH tunnel。  
4. 可選：`security.require_admin_totp`。  

CLI：`ysk-server security status --json`。

## 3. 第一個站點

```bash
export YSK_EXECUTE=1   # systemd／nginx 通常需 root
ysk-server projects create --name demo --domain demo.example.com --runtime node --json
ysk-server projects deploy --id <UUID> --execute --json
ysk-server nginx sync --execute --json
```

詳見：[../features/projects-ZH.md](../features/projects-ZH.md)。

## 4. DNS／SSL

- 在 DNS 供應商發布 A／AAAA（郵件則另加 MX／TXT）。  
- 上傳或申請憑證；於 nginx／SSL 綁定。  
- [../features/dns-ssl-nginx-ZH.md](../features/dns-ssl-nginx-ZH.md)

## 5. 可選郵件

```bash
ysk-server email bootstrap --domain example.com --ip YOUR_IP --json
ysk-server email deliverability --domain example.com --json
```

**PTR** 與 **Port 25**（或中繼）必須由你在外部完成。  
[../features/email-ZH.md](../features/email-ZH.md)

## 6. 防護與備份

```bash
ysk-server defense status --json
ysk-server backup schedule --install --execute
ysk-server readiness --json
```

## 7. 日常運維

| 任務 | 命令／介面 |
|------|------------|
| 就緒 | `readiness --json`／系統 → 就緒 |
| 日誌 | `logs query …`／日誌中心 |
| 更新 | `update --check` |
| 工作階段／金鑰 | `security sessions` · `security api-keys` |

## 安全提醒

- 主機變更預設 dry-run。  
- 已寫入 ≠ 已套用。  
- 無 EXECUTE／root 時 fail-closed 屬正常。  

完整 CLI：[../cli/reference-ZH.md](../cli/reference-ZH.md)。
