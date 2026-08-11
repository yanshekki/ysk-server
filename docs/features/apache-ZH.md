# Apache

> [English](./apache.md)

## 用途

喺 `/apache` 管理 Apache 站點同設定（**唯一入口**）。專案頁唔會發佈 Apache。

## UI

- 建立：反代／靜態／PHP
- 套用 → configtest + reload（需 `YSK_EXECUTE`）
- 全域設定 · 站點設定（Checkbox／SegRadio）
- **來源**：專案 · 獨立 · **磁碟（artifact）** — `dataDir/apache/sites` 未認領 conf
- 同一 `ServerName` 多列時顯示 **域名衝突**
- 磁碟列：預覽 conf · **移除殘留**（不作第二套 SSOT 編輯）
- 有衝突殘留時工具列：**清理衝突殘留**

## 權威來源與殘留

| 來源 | 權威 | 同步至系統 |
|------|------|------------|
| 專案（PHP） | 專案域名 + `ysk-{linuxUser}.conf` | 是（owned） |
| 獨立站 | `sites.json` | 是（owned） |
| 磁碟 artifact | 僅發現 | **否**（sync 不推上系統） |

移除殘留會刪 managed conf；有 execute／root 時停用系統副本。套用 PHP 專案時亦會 **退役** 同域名、非其他現役專案擁有的 conf。

## 相關

- [Nginx](./nginx-ZH.md) — 專案 edge 以 Nginx 為主
