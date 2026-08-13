# 專案

> 語言：中文（香港書面語）| [English](./projects.md)

## 用途

主機上一等公民 **站點**：建立、部署、停止、健康、git 部署、OS 隔離與範本 — 多 runtime（Node／PHP／static／…）。

**非目標：** 多租戶 Reseller 層級；專案 UI 不發佈 Apache（請用 `/apache`）。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/projects`、`/projects/:id` |
| 導航鍵 | `projects` |
| 主要操作 | 列表 · 建立 · 部署 · 停止 · 健康 · git · 隔離 · 範本 |
| 能力 | 專案 |
| RBAC | 專案操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 列表／查詢 | `ysk-server projects list\|get` | read | |
| 建立 | `ysk-server projects create …` | write-panel | `--create-dns`／`--create-mail` 對齊面板勾選（只寫草稿） |
| 部署／停止／健康 | `ysk-server projects deploy\|stop\|health` | write-host | deploy 需 execute |
| Git 部署 | `ysk-server projects git-deploy …` | write-host | |
| 隔離 | `ysk-server projects isolation …` | write-host | |
| 範本 | `ysk-server templates list\|apply` | write-panel | |
| 專案 FTP（路徑 Jail） | `ysk-server projects ftp --id UUID --password P` | write-panel | 草稿；到 `/ftp` 套用 |

## CLI 速查

```bash
ysk-server projects list --json
ysk-server projects create --name demo --domain demo.example.com --runtime node --create-dns --create-mail --json
export YSK_EXECUTE=1
ysk-server projects deploy --id UUID --execute --json
```

## 誠實邊界

- 無 EXECUTE 時部署僅為計劃。  
- 啟用 systemd unit 常需 root。  
- 已部署 ≠ 已對外發佈（仍需 nginx／ssl 套用）。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| — | 無 |

## 相關

- [執行環境](./runtimes-ZH.md) · [Nginx](./dns-ssl-nginx-ZH.md) · [CLI 參考](../cli/reference-ZH.md)  
