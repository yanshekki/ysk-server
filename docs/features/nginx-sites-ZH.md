# Nginx 站點

> 語言：中文（香港書面語）| [English](./nginx-sites.md)

## 用途

Nginx 作為專案 **預設邊緣**：狀態探測、受管 conf 清冊、設定測試，以及同步至系統 conf.d。

**非目標：** 完整視覺站點建構器；由專案頁雙重發佈 Apache。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/nginx` |
| 導航鍵 | `nginx` |
| 主要操作 | 狀態 · conf 列表 · 測試 · 同步 |
| 能力 | Nginx |
| RBAC | 託管操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 狀態／總覽 | `ysk-server nginx status --json` | read | 有 binary 時含 nginx -t |
| 列出受管 conf | `ysk-server nginx list --json` | read | |
| 設定測試 | `ysk-server nginx test --json` | read | |
| 同步至主機 | `ysk-server nginx sync --execute --json` | write-host | |

## CLI 速查

```bash
ysk-server nginx status --json
ysk-server nginx list --json
export YSK_EXECUTE=1
ysk-server nginx sync --execute --json
```

## 誠實邊界

- 同步在 `--execute` 前為試跑。  
- `nginx -t` 失敗則不可誠實宣稱「已套用」。  
- Conf 預覽不會把 `set_real_ip_from` CIDR 做成封禁連結。空域名仍會顯示檔內 `server_name`。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| — | 無 |

## 相關

- [DNS／SSL／Nginx](./dns-ssl-nginx-ZH.md) · [專案](./projects-ZH.md)  
