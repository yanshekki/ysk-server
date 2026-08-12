# 檔案、WebDAV 與 FTP

> 語言：中文（香港書面語）| [English](./files-ftp.md)

## 用途

沙箱 **檔案管理**（public 或專案根）、**公開分享連結**、**WebDAV**，以及 **FTPS 帳戶**／vsftpd 服務。

**非目標：** 以遠端 SSH 產品方式瀏覽整機檔案系統；公開 share 落地頁屬面板 HTTP（建立仍用 CLI／API）。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/files`、`/ftp`、公開檔案站 |
| 導航鍵 | `files`、`publicFiles`、`ftp` |
| 主要操作 | CRUD · 回收桶 · 分享 · 收藏 · WebDAV · FTPS 帳戶／設定 |
| 能力 | 檔案／FTPS |
| RBAC | 檔案與 FTP 操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 列表／讀寫／mkdir／rm… | `ysk-server files list\|read\|write\|… --root public\|project:ID` | write-panel | |
| 回收桶 | `ysk-server files trash list\|restore\|purge` | write-panel | |
| 分享列表 | `ysk-server files shares list` | read | |
| 分享建立／刪除 | `ysk-server files shares create\|delete` | write-panel | |
| 上載本機檔 | `ysk-server files upload --dir … --file …` | write-panel | |
| WebDAV | `ysk-server files webdav status\|token\|disable` | write-panel | |
| FTP 狀態／設定 | `ysk-server ftp status\|settings …` | read／write-panel | |
| FTP 帳戶 CRUD | `ysk-server ftp accounts list\|create\|update\|delete` | write-panel | |
| FTP 套用主機 | `ysk-server ftp apply\|accounts apply --execute` | write-host | |
| 公開檔案站 | `ysk-server hosting public-files …` | write-host | |

## CLI 速查

```bash
ysk-server files list --root public --json
ysk-server files shares create --path docs --root public --json
ysk-server ftp accounts list --json
export YSK_EXECUTE=1
ysk-server ftp apply --execute --json
```

## 誠實邊界

- 檔案操作受限於所選 root。  
- FTPS 套用需 EXECUTE + root（vsftpd）。  
- 公開 `/share/:token` 頁為 UX；**建立**屬 CLI／API。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 瀏覽器內預覽編輯器 | 使用 `files read/write` |
| 公開分享落地頁 | 公開 HTTP |

## 相關

- [CLI 參考 — files／ftp](../cli/reference-ZH.md)  
- [面板 ↔ CLI 矩陣](../cli/panel-parity-matrix-ZH.md)  
