# Apache

> 語言：中文（香港書面語）| [English](./apache.md)

## 用途

於 `/apache` 管理 **Apache** 虛擬主機與全域設定（**唯一入口**）。專案頁不會發佈 Apache。

**非目標：** 取代 Nginx 作為預設專案邊緣；同一站點雙重 SSOT。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/apache` |
| 導航鍵 | `apache` |
| 主要操作 | 站點列表 · 建立 · 套用 · 設定 · 清理衝突 · 移除殘留 |
| 能力 | 託管／Apache |
| RBAC | 託管操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 列出站點（合併） | `ysk-server apache sites list --json` | read | 可 `--source`／`--q` |
| 建立獨立站 | `ysk-server apache sites create --server-name … --json` | write-panel | |
| 更新站點 | `ysk-server apache sites update --id … --json` | write-panel | 非 project/artifact id |
| 刪除站點 | `ysk-server apache sites delete --id …` | write-panel | artifact 需 execute |
| 套用至主機 | `ysk-server apache sites apply --id … --execute --json` | write-host | |
| 顯示 conf | `ysk-server apache sites conf --id … --json` | read | |
| 清理 ServerName 衝突 | `ysk-server apache sites cleanup-conflicts --execute` | write-host | |
| 設定讀寫 | `ysk-server apache settings get\|set …` | write-panel | |
| 設定套用 | `ysk-server apache settings apply --execute` | write-host | 可能同步服務暴露 |

## CLI 速查

```bash
ysk-server apache sites list --json
ysk-server apache sites create --server-name app.example.com --kind proxy --upstream 127.0.0.1:3000 --json
export YSK_EXECUTE=1
ysk-server apache sites apply --id SITE_ID --execute --json
ysk-server apache settings get --json
```

完整 argv：[../cli/reference-ZH.md](../cli/reference-ZH.md#apache)。

## 權威模型

| 來源 | 權威 | 同步至系統 |
|------|------|------------|
| 專案（PHP） | 專案域名 + `ysk-{linuxUser}.conf` | 是（owned） |
| 獨立站 | `sites.json` | 是（owned） |
| 磁碟 artifact | 僅發現 | **否**（不作第二套 SSOT） |

## 誠實邊界

- 套用需 EXECUTE + root（configtest／reload）。  
- 資料目錄中 **已寫入** conf ≠ 線上 Apache，直至套用成功。  
- artifact 列為殘留發現；移除時請謹慎。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| — | 無 |

## 相關

- [Nginx 站點](./nginx-sites-ZH.md) — 預設專案邊緣  
- [面板 ↔ CLI 矩陣](../cli/panel-parity-matrix-ZH.md)  
- [CLI 參考 — apache](../cli/reference-ZH.md#apache)  
