# DNS、SSL 與 Nginx

> 語言：中文（香港書面語）| [English](./dns-ssl-nginx.md)

## 用途

管理 **DNS 區域**（已寫入 vs 線上）、**TLS 憑證**，以及作為預設專案邊緣的 **Nginx** — 含 DNSSEC 輔助、PowerDNS heal 與憑證清冊。

**非目標：** 代管外部 DNS 供應商帳號；僅寫入 zone 檔並非公開權威，直至套用／reload 成功。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/dns`、`/ssl`、`/nginx` |
| 導航鍵 | `dns`、`ssl`、`nginx` |
| 主要操作 | 區域 · 記錄驗證 · DNSSEC · heal · 憑證 · nginx 狀態／同步 |
| 能力 | DNS／SSL／Nginx |
| RBAC | 託管操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 列表／寫入區域 | `ysk-server dns zones\|zone …` | write-host | zone 寫入可能 reload |
| DNSSEC 列表／產生 | `ysk-server dns dnssec list\|generate --zone …` | write-host | generate 需 execute |
| Heal PowerDNS | `ysk-server dns heal --execute` | write-host | |
| DNS 健康／查詢 | `ysk-server dns health\|lookup …` | read | |
| 驗證記錄集 | `ysk-server dns records --records '[]'` | read | |
| SSL 列表／查詢 | `ysk-server ssl list\|get --domain …` | read | |
| Bootstrap／面板 TLS | `ysk-server ssl bootstrap\|panel-tls …` | write-host | |
| Nginx 狀態／列表／測試／同步 | `ysk-server nginx status\|list\|test\|sync` | write-host | sync |

## CLI 速查

```bash
ysk-server dns zones --json
ysk-server dns health --json
ysk-server ssl list --json
ysk-server nginx status --json
export YSK_EXECUTE=1
ysk-server nginx sync --execute --json
ysk-server dns dnssec generate --zone example.com --execute --json
```

## 誠實邊界

- 資料目錄中 **已寫入** zone ≠ 公眾解析真相。  
- LE 簽發需外網 + EXECUTE。  
- Nginx 同步在 `--execute` 前為試跑。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| — | 無 |

## 相關

- [Nginx 站點](./nginx-sites-ZH.md)  
- [Apache](./apache-ZH.md)  
- [CLI 參考](../cli/reference-ZH.md)  
