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
| Git 部署 | `ysk-server projects git-deploy --id UUID [--git-url URL] [--branch|--ref B]` | write-host | 首次 clone 為淺層（depth 1）。建立只存 `--git-url`／`--branch`，不會即時 clone。 |
| Git 控制 | `ysk-server projects git status\|log\|fetch\|checkout\|reset --id UUID` | read／write-host | status／log 唯讀。本機改動會阻止 pull。同步後用控制面還原 `.env`。 |
| Git 認證 | `ysk-server projects git auth --id UUID --token T \| --deploy-key \| --pin-host` | write-panel | HTTPS token 加密存放。SSH deploy key + 釘選 known_hosts。無 OAuth。Token 不會寫入 remote URL。 |
| Git hook | `ysk-server projects git hook --id UUID --enable\|--rotate\|--disable` | write-panel | Inbound `POST /api/v1/hooks/git/:id`。請自行把 URL + secret 貼到 GitHub／Gitea／GitLab（push）。不是 Slack。 |
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
- Inbound Git hook 無需面板登入即可回應，但 clone／部署仍需主機 unit 設 `YSK_EXECUTE=1`。

## Inbound Git hook

由操作員自行把 webhook 貼到 Git 平台。不是 Slack，亦不是 OAuth。YSK Server 不會代你在遠端建立 hook。

1. 專案 **App** 分頁 → **開啟 hook** → 複製完整 URL 與一次性 secret。
2. 到 **GitHub**／**Gitea**／**GitLab** 自行新增 webhook：
   - Payload URL：`https://<panel-host>:9287/api/v1/hooks/git/<project-uuid>`
   - Content type：`application/json`
   - Secret：一次性密鑰（GitHub／Gitea 用 HMAC，GitLab 用 secret token，或標頭 `X-YSK-Git-Hook`）
   - 事件：只選 **push**
3. GitHub.com 需要 HTTPS。同網段的 Gitea／GitLab 可用 HTTP。
4. 只會同步本專案已存的 ref。其他分支的 push 回 `{ ok: true, skipped: "ref" }`。
5. 關閉 hook 會停止同步但保留已存 secret。更換 secret 會發出新密鑰（只顯示一次）。

測試：

```bash
curl -X POST -H 'X-YSK-Git-Hook: SECRET' https://host:9287/api/v1/hooks/git/UUID
```

CLI：`ysk-server projects git hook --id UUID --enable|--rotate|--disable`  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| — | 無 |

## 相關

- [執行環境](./runtimes-ZH.md) · [Nginx](./dns-ssl-nginx-ZH.md) · [CLI 參考](../cli/reference-ZH.md)  
