# 專案與部署

> 語言：中文 | [English](./projects.md)

**面板路由：** `/projects`、`/projects/:id`  
**CLI：** `projects`、`templates`、`hosting`、`nginx`

## 功能

一部主機跑多個站點。每專案有 runtime、域名、home／linux 用戶（已 provision 時）、env、日誌與部署路徑。

| Runtime | 部署路徑 |
|---------|----------|
| Node | systemd unit → PM2 → pidfile 後備 |
| PHP | PHP-FPM + nginx，或降級 `php -S` |
| static | nginx `root` + try_files |

## 面板流程

1. 建立專案（名稱、域名、runtime）。  
2. **網絡**分頁：域名、發布 nginx（可選 SSL）。  
3. **部署**：啟動行程／FPM／static。  
4. 按需 Git 部署或上傳檔案。  
5. 隔離：就緒後 provision OS 用戶。  

## CLI

```bash
ysk-server projects list --json
ysk-server projects create --name demo --domain demo.local --runtime node
ysk-server projects deploy --id UUID --execute --json
ysk-server projects git-deploy --id UUID --ref main --execute
ysk-server projects isolation list
ysk-server projects isolation provision --id UUID
ysk-server templates list
```

## 誠實邊界

| 無 EXECUTE／root | 有 EXECUTE + root |
|------------------|-------------------|
| dataDir unit／ecosystem **已寫入** | 可裝 systemd、真實行程 |
| dataDir 內 nginx conf | 可 reload 系統 conf.d |
| health 可能失敗 | 真實監聽 + health |

## 相關

[dns-ssl-nginx-ZH.md](./dns-ssl-nginx-ZH.md) · [runtimes-ZH.md](./runtimes-ZH.md) · [../deploy/isolation-ZH.md](../deploy/isolation-ZH.md) · [../cli/reference-ZH.md](../cli/reference-ZH.md)
